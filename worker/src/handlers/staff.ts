import type {
  LoginResponse,
  MeResponse,
  MyAttendanceResponse,
  Punch,
  PunchRequest,
  PunchResponse,
  RegisterRequest,
  Shift,
  Staff,
} from '../../../shared/types';
import {
  breakMinutes,
  calcDays,
  currentSession,
  lateMinutes,
  otMinutes,
  shiftEndMs,
  shiftForTime,
  shiftStartMs,
  summarize,
} from '../attendance';
import { type SessionUser, signSession, verifyLineIdToken } from '../auth';
import { type Ctx, displayName, findMe, readJson, requireActive, requireUser } from '../ctx';
import { appendRows, load, writeRow } from '../data';
import { fmtDistance, haversineM, nearestStore } from '../geo';
import { HEADERS, SHEET, attendanceSheet, punchToRec, staffToRec, toRow } from '../schema';
import type { Sheets } from '../sheets';
import { addDays, bkkDate, bkkIso, bkkMonth, bkkTime, isMonthStr, monthRange, monthsBetween } from '../time';
import { HttpError, newId, str } from '../util';

const byStart = (a: Shift, b: Shift) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start);

async function buildMe(sheets: Sheets, user: SessionUser): Promise<MeResponse> {
  const nowMs = Date.now();
  const today = bkkDate(nowMs);
  const d = await load(sheets, {
    staff: true,
    stores: true,
    shiftTypes: true,
    shifts: true,
    settings: true,
    months: monthsBetween(bkkDate(nowMs - 86_400_000), today),
  });
  const me = findMe(d, user);
  const base: MeResponse = {
    me,
    claimable: me
      ? []
      : d.staff
          .filter((s) => !s.lineUserId && s.status !== 'inactive')
          .map((s) => ({ id: s.id, name: s.name, nickname: s.nickname, storeId: s.storeId })),
    lineName: user.name,
    stores: d.stores.filter((s) => s.active),
    shiftTypes: d.shiftTypes.filter((t) => t.active),
    settings: d.settings,
    openPunch: null,
    sessionPunches: [],
    todayPunches: [],
    todayShifts: [],
    upcomingShifts: [],
    serverTime: bkkIso(nowMs),
  };
  if (!me || me.status !== 'active') return base;
  const mine = d.punches.filter((p) => p.staffId === me.id);
  const session = currentSession(mine, nowMs);
  const until = addDays(today, 13);
  const myShifts = d.shifts.filter((s) => s.staffId === me.id);
  return {
    ...base,
    openPunch: session?.in ?? null,
    sessionPunches: session?.rest ?? [],
    todayPunches: mine.filter((p) => p.date === today),
    todayShifts: myShifts.filter((s) => s.date === today).sort(byStart),
    upcomingShifts: myShifts.filter((s) => s.date >= today && s.date <= until).sort(byStart),
  };
}

/** POST /api/auth/login { idToken } */
export async function login(c: Ctx): Promise<LoginResponse> {
  const { idToken } = await readJson<{ idToken?: string }>(c.req);
  if (!idToken) throw new HttpError(400, 'ไม่มี idToken');
  const user = await verifyLineIdToken(c.env, idToken);
  const [token, me] = await Promise.all([signSession(c.env, user), buildMe(c.sheets, user)]);
  return { token, ...me };
}

/** GET /api/me */
export async function getMe(c: Ctx): Promise<MeResponse> {
  return buildMe(c.sheets, requireUser(c));
}

/**
 * POST /api/register
 * Either links this LINE account to a staff row the owner created (claimId), or creates a new row.
 * Both end as "pending" until the owner approves, unless the owner code (SETUP_KEY) is given.
 */
export async function register(c: Ctx): Promise<MeResponse> {
  const user = requireUser(c);
  const body = await readJson<RegisterRequest>(c.req);
  const nickname = str(body.nickname).slice(0, 40);
  const phone = str(body.phone).replace(/[^\d+]/g, '').slice(0, 20);

  const d = await load(c.sheets, { staff: true, stores: true });
  if (findMe(d, user)) throw new HttpError(409, 'บัญชี LINE นี้ลงทะเบียนแล้ว');

  let role: Staff['role'] = 'staff';
  let status: Staff['status'] = 'pending';
  if (body.ownerCode) {
    if (!c.env.SETUP_KEY || body.ownerCode !== c.env.SETUP_KEY) throw new HttpError(403, 'รหัสเจ้าของร้านไม่ถูกต้อง');
    role = 'owner';
    status = 'active';
  }

  const claimed = body.claimId ? d.staff.find((s) => s.id === body.claimId) : undefined;
  if (body.claimId) {
    if (!claimed || claimed.status === 'inactive') throw new HttpError(400, 'ไม่พบชื่อนี้ในรายชื่อพนักงาน');
    if (claimed.lineUserId) throw new HttpError(409, 'ชื่อนี้ถูกเชื่อมกับบัญชี LINE อื่นแล้ว กรุณาติดต่อเจ้าของร้าน');
  }

  const name = str(body.name).slice(0, 80) || claimed?.name || '';
  if (!name) throw new HttpError(400, 'กรุณากรอกชื่อ-นามสกุล');
  if (!d.stores.some((s) => s.id === body.storeId)) throw new HttpError(400, 'กรุณาเลือกสาขา');

  const staff: Staff = {
    id: claimed?.id ?? newId('ST'),
    lineUserId: user.uid,
    lineName: user.name,
    name,
    nickname: nickname || claimed?.nickname || '',
    phone: phone || claimed?.phone || '',
    role: role === 'owner' ? 'owner' : (claimed?.role ?? 'staff'),
    storeId: body.storeId,
    status,
    createdAt: claimed?.createdAt || bkkIso(Date.now()),
  };
  const table = d.tables[SHEET.staff]!;
  if (claimed) {
    await writeRow(c.sheets, SHEET.staff, table, d.rowOf.staff.get(claimed.id)!, staffToRec(staff), d.recOf.staff.get(claimed.id));
  } else {
    await appendRows(c.sheets, SHEET.staff, table.headers, [toRow(staffToRec(staff), table.headers)]);
  }
  return buildMe(c.sheets, user);
}

/**
 * POST /api/punch { type, lat, lng, accuracy }
 * IN / OUT must be inside a store's radius. BREAK_START / BREAK_END don't need a location
 * (staff may step out for lunch); the location is recorded when the phone sends one.
 */
export async function punch(c: Ctx): Promise<PunchResponse> {
  const user = requireUser(c);
  const body = await readJson<PunchRequest>(c.req);
  const type = body.type;
  if (!['IN', 'OUT', 'BREAK_START', 'BREAK_END'].includes(type)) throw new HttpError(400, 'ประเภทการลงเวลาไม่ถูกต้อง');
  const isBreak = type === 'BREAK_START' || type === 'BREAK_END';
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const accuracy = Number(body.accuracy);
  const hasPos =
    body.lat != null && body.lng != null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (!isBreak && !hasPos) throw new HttpError(400, 'ไม่พบตำแหน่ง GPS');

  const nowMs = Date.now();
  const today = bkkDate(nowMs);
  const d = await load(c.sheets, {
    staff: true,
    stores: true,
    shiftTypes: true,
    shifts: true,
    settings: true,
    months: monthsBetween(bkkDate(nowMs - 86_400_000), today),
  });
  const me = requireActive(d, user);

  const mine = d.punches.filter((p) => p.staffId === me.id);
  const session = currentSession(mine, nowMs);
  const open = session?.in ?? null;
  const last = session ? (session.rest[session.rest.length - 1] ?? session.in) : null;

  // State checks first, so a wrong button gets a clear message before any GPS complaint
  if (type === 'IN' && open) throw new HttpError(409, `คุณลงเวลาเข้างานไปแล้วเมื่อ ${open.time.slice(0, 5)} น.`);
  if (type !== 'IN' && !open) throw new HttpError(409, 'ยังไม่ได้ลงเวลาเข้างาน');
  if (type === 'BREAK_START' && session?.onBreak) throw new HttpError(409, `กำลังพักอยู่ (เริ่มพัก ${session.onBreak.time.slice(0, 5)} น.)`);
  if (type === 'BREAK_END' && !session?.onBreak) throw new HttpError(409, 'ยังไม่ได้กดเริ่มพัก');
  if (type !== 'IN' && last && nowMs - last.ms < 60_000) {
    throw new HttpError(409, 'เพิ่งลงเวลาไปเมื่อครู่ กรุณารอสักครู่แล้วกดใหม่');
  }

  let store = d.stores.find((s) => s.id === open?.storeId) ?? null;
  let distanceM = 0;
  if (!isBreak) {
    if (!Number.isFinite(accuracy) || accuracy > d.settings.maxAccuracyM) {
      throw new HttpError(
        422,
        `สัญญาณ GPS ยังไม่แม่นยำพอ (±${Math.round(accuracy)} ม.) ลองเปิด Wi-Fi/ออกไปใกล้หน้าต่าง แล้วกดใหม่`,
      );
    }
    const near = nearestStore(d.stores, lat, lng);
    if (!near) throw new HttpError(500, 'ยังไม่ได้ตั้งค่าสาขาในชีต Stores');
    if (near.distanceM > near.store.radiusM) {
      throw new HttpError(
        422,
        `คุณอยู่นอกพื้นที่ร้าน (ห่าง ${fmtDistance(near.distanceM)} จาก ${near.store.name}) — ต้องอยู่ภายใน ${near.store.radiusM} ม.`,
        { distanceM: Math.round(near.distanceM), storeId: near.store.id },
      );
    }
    store = near.store;
    distanceM = near.distanceM;
  } else if (hasPos && store) {
    distanceM = haversineM(lat, lng, store.lat, store.lng);
  }

  const p: Punch = {
    id: newId('AT'),
    ms: nowMs,
    ts: bkkIso(nowMs),
    date: today,
    time: bkkTime(nowMs),
    staffId: me.id,
    storeId: store?.id ?? open?.storeId ?? '',
    type,
    lat: hasPos ? Math.round(lat * 1e6) / 1e6 : 0,
    lng: hasPos ? Math.round(lng * 1e6) / 1e6 : 0,
    accuracyM: hasPos && Number.isFinite(accuracy) ? Math.round(accuracy) : 0,
    distanceM: Math.round(distanceM),
  };
  const storeName = store?.name ?? p.storeId;

  const rec = punchToRec(p, displayName(me), storeName);
  if (!hasPos) Object.assign(rec, { lat: '', lng: '', accuracy_m: '', distance_m: '' });
  const sheet = attendanceSheet(bkkMonth(nowMs));
  const headers = d.tables[sheet]?.headers ?? HEADERS.Attendance;
  await appendRows(c.sheets, sheet, headers, [toRow(rec, headers)]);

  const myShifts = d.shifts.filter((s) => s.staffId === me.id);
  const shift = shiftForTime(myShifts, type === 'IN' ? nowMs : open!.ms);
  const hhmm = p.time.slice(0, 5);
  let lateMin = 0;
  let otMin = 0;
  let message: string;
  if (type === 'IN') {
    if (shift) lateMin = lateMinutes(nowMs, shiftStartMs(shift), d.settings);
    message = `ลงเวลาเข้างาน ${hhmm} น. · ${storeName}`;
    if (!shift) message += ' (วันนี้ไม่มีกะในตาราง)';
    else if (lateMin > 0) message += ` · สาย ${lateMin} นาที`;
  } else if (type === 'BREAK_START') {
    message = `เริ่มพัก ${hhmm} น.`;
    if (shift?.breakMin) message += ` · พักได้ ${shift.breakMin} นาที`;
  } else if (type === 'BREAK_END') {
    const taken = breakMinutes([...session!.rest, p], nowMs);
    message = `กลับเข้างาน ${hhmm} น. · พักไปแล้วรวม ${taken} นาที`;
    if (shift && taken - shift.breakMin > d.settings.lateGraceMin) message += ` (เกิน ${taken - shift.breakMin} นาที)`;
  } else {
    if (shift) otMin = otMinutes(nowMs, shiftEndMs(shift), d.settings);
    message = `ลงเวลาออก ${hhmm} น. · ${storeName}`;
    if (session?.onBreak) message += ' (จบการพักอัตโนมัติ)';
    if (otMin > 0) message += ` · OT ${otMin} นาที`;
  }

  return { punch: p, storeName, distanceM: p.distanceM, lateMin, otMin, shift, message };
}

/** GET /api/my/attendance?month=YYYY-MM */
export async function myAttendance(c: Ctx): Promise<MyAttendanceResponse> {
  const user = requireUser(c);
  const nowMs = Date.now();
  const month = c.url.searchParams.get('month') || bkkMonth(nowMs);
  if (!isMonthStr(month)) throw new HttpError(400, 'เดือนไม่ถูกต้อง');
  const { from, to } = monthRange(month);
  const d = await load(c.sheets, {
    staff: true,
    shiftTypes: true,
    shifts: true,
    settings: true,
    months: monthsBetween(addDays(from, -1), addDays(to, 1)),
  });
  const me = requireActive(d, user);
  const days = calcDays({
    staffIds: [me.id],
    shifts: d.shifts,
    punches: d.punches,
    settings: d.settings,
    from,
    to,
    nowMs,
    shiftNames: new Map(d.shiftTypes.map((t) => [t.id, t.name])),
  });
  const [summary] = summarize(days, [{ id: me.id, name: displayName(me) }]);
  return { month, summary, days };
}
