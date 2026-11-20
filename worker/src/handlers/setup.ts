import type { ShiftType, Store } from '../../../shared/types';
import type { Ctx } from '../ctx';
import { appendRows, ensureSheet, load } from '../data';
import {
  DEFAULT_SETTINGS,
  HEADERS,
  SETTING_ROWS,
  SHEET,
  attendanceSheet,
  shiftTypeToRec,
  storeToRec,
  toRow,
} from '../schema';
import { bkkMonth } from '../time';
import { HttpError, str } from '../util';

// Mock coordinates in Bangkok — replace them later from the app (จัดการ > สาขา > ใช้ตำแหน่งปัจจุบัน)
const SEED_STORES: Store[] = [
  { id: 'S1', name: 'Jingjo Coconut สาขา 1', lat: 13.745543, lng: 100.534004, radiusM: 150, active: true },
  { id: 'S2', name: 'Jingjo Coconut สาขา 2', lat: 13.779694, lng: 100.544637, radiusM: 150, active: true },
];

// Two 9-hour shifts per store with a 1-hour break = 8 working hours each
const SEED_SHIFT_TYPES: ShiftType[] = SEED_STORES.flatMap((s) => [
  { id: `${s.id}-M`, storeId: s.id, name: 'เช้า', start: '08:30', end: '17:30', breakMin: 60, active: true },
  { id: `${s.id}-E`, storeId: s.id, name: 'เย็น', start: '12:30', end: '21:30', breakMin: 60, active: true },
]);

/**
 * POST /api/setup  (header: X-Setup-Key: <SETUP_KEY>)
 * Creates missing tabs + headers and seeds mock stores, shift templates and settings.
 * Safe to run more than once: it never overwrites existing data.
 */
export async function setup(c: Ctx) {
  if (!c.env.SETUP_KEY || c.req.headers.get('x-setup-key') !== c.env.SETUP_KEY) {
    throw new HttpError(403, 'X-Setup-Key ไม่ถูกต้อง');
  }
  const created: string[] = [];
  const titles = await c.sheets.titles();
  const tabs: [string, string[]][] = [
    [SHEET.stores, HEADERS.Stores],
    [SHEET.staff, HEADERS.Staff],
    [SHEET.shiftTypes, HEADERS.ShiftTypes],
    [SHEET.shifts, HEADERS.Shifts],
    [SHEET.settings, HEADERS.Settings],
    [attendanceSheet(bkkMonth(Date.now())), HEADERS.Attendance],
  ];
  for (const [name, headers] of tabs) {
    if (!titles.has(name) && (await ensureSheet(c.sheets, name, headers))) created.push(name);
  }

  const d = await load(c.sheets, { stores: true, shiftTypes: true, settings: true });
  const seeded: string[] = [];

  if (!d.stores.length) {
    const h = d.tables[SHEET.stores]!.headers;
    await appendRows(c.sheets, SHEET.stores, h, SEED_STORES.map((s) => toRow(storeToRec(s), h)));
    seeded.push(`Stores (${SEED_STORES.length})`);
  }
  if (!d.shiftTypes.length) {
    const h = d.tables[SHEET.shiftTypes]!.headers;
    await appendRows(c.sheets, SHEET.shiftTypes, h, SEED_SHIFT_TYPES.map((t) => toRow(shiftTypeToRec(t), h)));
    seeded.push(`ShiftTypes (${SEED_SHIFT_TYPES.length})`);
  }
  const haveKeys = new Set(d.tables[SHEET.settings]!.rows.map((r) => str(r.data.key)));
  const missing = SETTING_ROWS.filter((s) => !haveKeys.has(s.key));
  if (missing.length) {
    const h = d.tables[SHEET.settings]!.headers;
    await appendRows(
      c.sheets,
      SHEET.settings,
      h,
      missing.map((s) => toRow({ key: s.key, value: DEFAULT_SETTINGS[s.field], description: s.description }, h)),
    );
    seeded.push(`Settings (${missing.length})`);
  }

  return {
    ok: true,
    created,
    seeded,
    next: 'เปิดแอปใน LINE แล้วลงทะเบียนด้วย "รหัสเจ้าของร้าน" (= SETUP_KEY) เพื่อเป็นเจ้าของร้านคนแรก',
  };
}
