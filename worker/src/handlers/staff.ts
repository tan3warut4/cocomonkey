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
import { calcDays, openPunchOf, otMinutes, shiftEndMs, shiftForTime, shiftStartMs, lateMinutes, summarize } from '../attendance';
import { type SessionUser, signSession, verifyLineIdToken } from '../auth';
import { type Ctx, displayName, findMe, readJson, requireActive, requireUser } from '../ctx';
import { appendRows, load } from '../data';
import { fmtDistance, nearestStore } from '../geo';
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
    lineName: user.name,
    stores: d.stores.filter((s) => s.active),
    shiftTypes: d.shiftTypes.filter((t) => t.active),
    settings: d.settings,
    openPunch: null,
    todayPunches: [],
    todayShifts: [],
    upcomingShifts: [],
    serverTime: bkkIso(nowMs),
  };
  if (!me || me.status !== 'active') return base;
  const mine = d.punches.filter((p) => p.staffId === me.id);
  const until = addDays(today, 13);
  const myShifts = d.shifts.filter((s) => s.staffId === me.id);
  return {
    ...base,
    openPunch: openPunchOf(mine, nowMs),
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

/** POST /api/register */
export async function register(c: Ctx): Promise<MeResponse> {
  const user = requireUser(c);
  const body = await readJson<RegisterRequest>(c.req);
  const name = str(body.name).slice(0, 80);
  const nickname = str(body.nickname).slice(0, 40);
  const phone = str(body.phone).replace(/[^\d+]/g, '').slice(0, 20);
  if (!name) throw new HttpError(400, 'กรุณากรอกชื่อ-นามสกุล');

  const d = await load(c.sheets, { staff: true, stores: true });
  if (findMe(d, user)) throw new HttpError(409, 'บัญชี LINE นี้ลงทะเบียนแล้ว');
  if (!d.stores.some((s) => s.id === body.storeId)) throw new HttpError(400, 'กรุณาเลือกสาขา');

  let role: Staff['role'] = 'staff';
  let status: Staff['status'] = 'pending';
  if (body.ownerCode) {
    if (!c.env.SETUP_KEY || body.ownerCode !== c.env.SETUP_KEY) throw new HttpError(403, 'รหัสเจ้าของร้านไม่ถูกต้อง');
    role = 'owner';
    status = 'active';
  }

  const staff: Staff = {
    id: newId('ST'),
    lineUserId: user.uid,
    lineName: user.name,
    name,
    nickname,
    phone,
    role,
    storeId: body.storeId,
    status,
    createdAt: bkkIso(Date.now()),
  };
  const headers = d.tables[SHEET.staff]?.headers ?? HEADERS.Staff;
  await appendRows(c.sheets, SHEET.staff, headers, [toRow(staffToRec(staff), headers)]);
  return buildMe(c.sheets, user);
}

/** POST /api/punch { type, lat, lng, accuracy } */
export async function punch(c: Ctx): Promise<PunchResponse> {
  const user = requireUser(c);
  const body = await readJson<PunchRequest>(c.req);
  const type = body.type;
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const accuracy = Number(body.accuracy);
  if (type !== 'IN' && type !== 'OUT') throw new HttpError(400, 'ประเภทการลงเวลาไม่ถูกต้อง');
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new HttpError(400, 'ไม่พบตำแหน่ง GPS');
  }

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

  const mine = d.punches.filter((p) => p.staffId === me.id);
  const open = openPunchOf(mine, nowMs);
  if (type === 'IN' && open) throw new HttpError(409, `คุณลงเวลาเข้างานไปแล้วเมื่อ ${open.time.slice(0, 5)} น.`);
  if (type === 'OUT' && !open) throw new HttpError(409, 'ยังไม่ได้ลงเวลาเข้างาน');
  if (type === 'OUT' && open && nowMs - open.ms < 60_000) {
    throw new HttpError(409, 'เพิ่งลงเวลาเข้างาน กรุณารอสักครู่ก่อนลงเวลาออก');
  }

  const p: Punch = {
    id: newId('AT'),
    ms: nowMs,
    ts: bkkIso(nowMs),
    date: today,
    time: bkkTime(nowMs),
    staffId: me.id,
    storeId: near.store.id,
    type,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    accuracyM: Math.round(accuracy),
    distanceM: Math.round(near.distanceM),
  };

  const sheet = attendanceSheet(bkkMonth(nowMs));
  const headers = d.tables[sheet]?.headers ?? HEADERS.Attendance;
  await appendRows(c.sheets, sheet, headers, [toRow(punchToRec(p, displayName(me), near.store.name), headers)]);

  const myShifts = d.shifts.filter((s) => s.staffId === me.id);
  const shift = shiftForTime(myShifts, type === 'IN' ? nowMs : open!.ms);
  const hhmm = p.time.slice(0, 5);
  let lateMin = 0;
  let otMin = 0;
  let message: string;
  if (type === 'IN') {
    if (shift) lateMin = lateMinutes(nowMs, shiftStartMs(shift), d.settings);
    message = `ลงเวลาเข้างาน ${hhmm} น. · ${near.store.name}`;
    if (!shift) message += ' (วันนี้ไม่มีกะในตาราง)';
    else if (lateMin > 0) message += ` · สาย ${lateMin} นาที`;
  } else {
    if (shift) otMin = otMinutes(nowMs, shiftEndMs(shift), d.settings);
    message = `ลงเวลาออก ${hhmm} น. · ${near.store.name}`;
    if (otMin > 0) message += ` · OT ${otMin} นาที`;
  }

  return { punch: p, storeName: near.store.name, distanceM: p.distanceM, lateMin, otMin, shift, message };
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
