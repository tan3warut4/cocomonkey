import type {
  ReportResponse,
  RosterResponse,
  RosterSaveRequest,
  Shift,
  Staff,
  StaffUpdateRequest,
  StoreUpdateRequest,
  TodayResponse,
} from '../../../shared/types';
import { calcDays, summarize } from '../attendance';
import { type Ctx, displayName, readJson, requireOwner, requireUser } from '../ctx';
import { load, rowRange, writeRow } from '../data';
import { SHEET, type Rec, shiftToRec, staffToRec, storeToRec, toRow } from '../schema';
import {
  addDays,
  bkkDate,
  bkkIso,
  bkkMonth,
  daysBetween,
  isDateStr,
  isMonthStr,
  monthRange,
  monthsBetween,
  weekStart,
} from '../time';
import { HttpError, newId, str } from '../util';

const staffSort = (a: Staff, b: Staff) =>
  a.storeId.localeCompare(b.storeId) || (a.nickname || a.name).localeCompare(b.nickname || b.name, 'th');

// ---------- Staff ----------

/** GET /api/admin/staff */
export async function listStaff(c: Ctx) {
  const d = await load(c.sheets, { staff: true, stores: true });
  requireOwner(d, requireUser(c));
  return { staff: [...d.staff].sort(staffSort), stores: d.stores };
}

/** POST /api/admin/staff/:id */
export async function updateStaff(c: Ctx) {
  const body = await readJson<StaffUpdateRequest>(c.req);
  const d = await load(c.sheets, { staff: true, stores: true });
  const owner = requireOwner(d, requireUser(c));
  const target = d.staff.find((s) => s.id === c.params.id);
  if (!target) throw new HttpError(404, 'ไม่พบพนักงาน');

  const next: Staff = { ...target };
  if (body.status !== undefined) {
    if (!['pending', 'active', 'inactive'].includes(body.status)) throw new HttpError(400, 'สถานะไม่ถูกต้อง');
    next.status = body.status;
  }
  if (body.role !== undefined) {
    if (body.role !== 'owner' && body.role !== 'staff') throw new HttpError(400, 'สิทธิ์ไม่ถูกต้อง');
    next.role = body.role;
  }
  if (body.storeId !== undefined) {
    if (!d.stores.some((s) => s.id === body.storeId)) throw new HttpError(400, 'ไม่พบสาขา');
    next.storeId = body.storeId;
  }
  if (body.name !== undefined) next.name = str(body.name).slice(0, 80) || target.name;
  if (body.nickname !== undefined) next.nickname = str(body.nickname).slice(0, 40);
  if (body.phone !== undefined) next.phone = str(body.phone).replace(/[^\d+]/g, '').slice(0, 20);

  if (target.id === owner.id && (next.role !== 'owner' || next.status !== 'active')) {
    throw new HttpError(400, 'ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้');
  }

  const table = d.tables[SHEET.staff]!;
  await writeRow(c.sheets, SHEET.staff, table, d.rowOf.staff.get(target.id)!, staffToRec(next), d.recOf.staff.get(target.id));
  return { staff: next };
}

// ---------- Stores ----------

/** POST /api/admin/stores/:id */
export async function updateStore(c: Ctx) {
  const body = await readJson<StoreUpdateRequest>(c.req);
  const d = await load(c.sheets, { staff: true, stores: true });
  requireOwner(d, requireUser(c));
  const store = d.stores.find((s) => s.id === c.params.id);
  if (!store) throw new HttpError(404, 'ไม่พบสาขา');
  const next = { ...store };
  if (body.lat !== undefined || body.lng !== undefined) {
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new HttpError(400, 'พิกัดไม่ถูกต้อง');
    }
    next.lat = Math.round(lat * 1e6) / 1e6;
    next.lng = Math.round(lng * 1e6) / 1e6;
  }
  if (body.radiusM !== undefined) {
    const r = Math.round(Number(body.radiusM));
    if (!Number.isFinite(r) || r < 30 || r > 2000) throw new HttpError(400, 'รัศมีต้องอยู่ระหว่าง 30–2000 ม.');
    next.radiusM = r;
  }
  if (body.name !== undefined) next.name = str(body.name).slice(0, 80) || store.name;
  await writeRow(
    c.sheets,
    SHEET.stores,
    d.tables[SHEET.stores]!,
    d.rowOf.stores.get(store.id)!,
    storeToRec(next),
    d.recOf.stores.get(store.id),
  );
  return { store: next };
}

// ---------- Roster ----------

function rosterRange(c: Ctx): { from: string; to: string } {
  const q = c.url.searchParams.get('from');
  const from = weekStart(isDateStr(q) ? q : bkkDate(Date.now()));
  const days = Math.min(31, Math.max(1, Number(c.url.searchParams.get('days') || 7)));
  return { from, to: addDays(from, days - 1) };
}

async function rosterData(c: Ctx, from: string, to: string): Promise<RosterResponse> {
  const d = await load(c.sheets, { staff: true, stores: true, shiftTypes: true, shifts: true });
  requireOwner(d, requireUser(c));
  return {
    from,
    to,
    staff: d.staff.filter((s) => s.status === 'active').sort(staffSort),
    stores: d.stores,
    shiftTypes: d.shiftTypes,
    shifts: d.shifts.filter((s) => s.date >= from && s.date <= to),
  };
}

/** GET /api/admin/roster?from=YYYY-MM-DD&days=7 */
export async function getRoster(c: Ctx): Promise<RosterResponse> {
  const { from, to } = rosterRange(c);
  return rosterData(c, from, to);
}

/**
 * PUT /api/admin/roster
 * One shift per staff per day. A cell with shiftTypeId=null removes that day's shift.
 * Cells not sent are left untouched; unchanged cells keep any manual edits made in the sheet.
 */
export async function saveRoster(c: Ctx): Promise<RosterResponse> {
  const body = await readJson<RosterSaveRequest>(c.req);
  const { from, to } = body;
  if (!isDateStr(from) || !isDateStr(to) || to < from || daysBetween(from, to) > 31) {
    throw new HttpError(400, 'ช่วงวันที่ไม่ถูกต้อง');
  }
  if (!Array.isArray(body.cells) || body.cells.length > 1000) throw new HttpError(400, 'ข้อมูลตารางไม่ถูกต้อง');

  const d = await load(c.sheets, { staff: true, stores: true, shiftTypes: true, shifts: true });
  requireOwner(d, requireUser(c));
  const table = d.tables[SHEET.shifts]!;
  const headers = table.headers;
  const typeById = new Map(d.shiftTypes.map((t) => [t.id, t]));
  const staffIds = new Set(d.staff.map((s) => s.id));

  const existing = new Map<string, { row: number; shift: Shift; rec?: Rec }[]>();
  for (const s of d.shifts) {
    if (s.date < from || s.date > to) continue;
    const key = `${s.date}|${s.staffId}`;
    const list = existing.get(key) ?? [];
    list.push({ row: d.rowOf.shifts.get(s.id)!, shift: s, rec: d.recOf.shifts.get(s.id) });
    existing.set(key, list);
  }

  const nowIso = bkkIso(Date.now());
  const updates: { range: string; values: unknown[][] }[] = [];
  const clears: string[] = [];
  const newRecs: Rec[] = [];
  const seen = new Set<string>();

  for (const cell of body.cells) {
    if (!isDateStr(cell.date) || cell.date < from || cell.date > to) throw new HttpError(400, 'วันที่อยู่นอกช่วง');
    if (!staffIds.has(cell.staffId)) throw new HttpError(400, 'ไม่พบพนักงาน');
    const key = `${cell.date}|${cell.staffId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rows = existing.get(key) ?? [];

    if (!cell.shiftTypeId) {
      for (const r of rows) clears.push(rowRange(SHEET.shifts, headers, r.row));
      continue;
    }
    const type = typeById.get(cell.shiftTypeId);
    if (!type) throw new HttpError(400, `ไม่พบกะ ${cell.shiftTypeId}`);
    if (rows.length === 1 && rows[0].shift.shiftTypeId === type.id) continue; // unchanged

    const keep = rows[0];
    const shift: Shift = {
      id: keep && !keep.shift.id.startsWith('row') ? keep.shift.id : newId('SH'),
      date: cell.date,
      staffId: cell.staffId,
      storeId: type.storeId,
      shiftTypeId: type.id,
      start: type.start,
      end: type.end,
      breakMin: type.breakMin,
      note: '',
    };
    const rec = shiftToRec(shift, nowIso);
    if (keep) {
      updates.push({ range: rowRange(SHEET.shifts, headers, keep.row), values: [toRow({ ...keep.rec, ...rec }, headers)] });
      for (const extra of rows.slice(1)) clears.push(rowRange(SHEET.shifts, headers, extra.row));
    } else {
      newRecs.push(rec);
    }
  }

  // Reuse blank rows first so the sheet stays compact, then append the rest.
  const blanks = [...table.emptyRows];
  const toAppend: unknown[][] = [];
  for (const rec of newRecs) {
    const row = blanks.shift();
    if (row) updates.push({ range: rowRange(SHEET.shifts, headers, row), values: [toRow(rec, headers)] });
    else toAppend.push(toRow(rec, headers));
  }

  await c.sheets.update(updates);
  await c.sheets.clear(clears);
  await c.sheets.append(SHEET.shifts, toAppend);
  return rosterData(c, from, to);
}

// ---------- Today board & monthly report ----------

/** GET /api/admin/today */
export async function today(c: Ctx): Promise<TodayResponse> {
  const nowMs = Date.now();
  const date = bkkDate(nowMs);
  const d = await load(c.sheets, {
    staff: true,
    stores: true,
    shiftTypes: true,
    shifts: true,
    settings: true,
    months: monthsBetween(addDays(date, -1), date),
  });
  requireOwner(d, requireUser(c));
  const staff = d.staff.filter((s) => s.status === 'active').sort(staffSort);
  const days = calcDays({
    staffIds: staff.map((s) => s.id),
    shifts: d.shifts,
    punches: d.punches,
    settings: d.settings,
    from: date,
    to: date,
    nowMs,
    shiftNames: new Map(d.shiftTypes.map((t) => [t.id, t.name])),
  });
  return { date, stores: d.stores, staff, days };
}

/** GET /api/admin/report?month=YYYY-MM */
export async function report(c: Ctx): Promise<ReportResponse> {
  const nowMs = Date.now();
  const month = c.url.searchParams.get('month') || bkkMonth(nowMs);
  if (!isMonthStr(month)) throw new HttpError(400, 'เดือนไม่ถูกต้อง');
  const { from, to } = monthRange(month);
  const d = await load(c.sheets, {
    staff: true,
    stores: true,
    shiftTypes: true,
    shifts: true,
    settings: true,
    months: monthsBetween(addDays(from, -1), addDays(to, 1)),
  });
  requireOwner(d, requireUser(c));
  const days = calcDays({
    staffIds: d.staff.map((s) => s.id),
    shifts: d.shifts,
    punches: d.punches,
    settings: d.settings,
    from,
    to,
    nowMs,
    shiftNames: new Map(d.shiftTypes.map((t) => [t.id, t.name])),
  });
  const withData = new Set(days.map((x) => x.staffId));
  const staff = d.staff.filter((s) => s.status === 'active' || withData.has(s.id)).sort(staffSort);
  const summaries = summarize(
    days,
    staff.map((s) => ({ id: s.id, name: displayName(s) })),
  );
  return { month, from, to, staff, stores: d.stores, settings: d.settings, summaries, days };
}
