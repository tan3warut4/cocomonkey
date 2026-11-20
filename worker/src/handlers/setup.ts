import type { ShiftType, Staff, Store } from '../../../shared/types';
import type { Ctx } from '../ctx';
import { appendRows, ensureSheet, load } from '../data';
import {
  DEFAULT_SETTINGS,
  HEADERS,
  SETTING_ROWS,
  SHEET,
  attendanceSheet,
  shiftTypeToRec,
  staffToRec,
  storeToRec,
  toRow,
} from '../schema';
import { bkkMonth } from '../time';
import { HttpError, str } from '../util';

// Real store pins from Google Maps. To fine-tune, stand in the store and use
// จัดการร้าน > สาขา > ใช้ตำแหน่งปัจจุบัน. The two stores are ~350 m apart, so keep radius <= 170 m.
const SEED_STORES: Store[] = [
  { id: 'CHULA', name: 'Cocomonkey สาขาจุฬา', lat: 13.7309421, lng: 100.5368796, radiusM: 150, active: true },
  { id: 'SILOM', name: 'Cocomonkey สาขาสีลม', lat: 13.7283056, lng: 100.535095, radiusM: 150, active: true },
];

// 9-hour spans with a 1-hour break = 8 working hours, with ~30 min to open and close.
// Chula (hospital) is open 06:00-20:00, Sunday until 18:00. Silom Complex is open 10:00-21:00.
const SEED_SHIFT_TYPES: ShiftType[] = [
  { id: 'CHULA-M', storeId: 'CHULA', name: 'เช้า', start: '05:30', end: '14:30', breakMin: 60, active: true },
  { id: 'CHULA-E', storeId: 'CHULA', name: 'บ่าย', start: '11:30', end: '20:30', breakMin: 60, active: true },
  { id: 'CHULA-SUN', storeId: 'CHULA', name: 'บ่าย (อา.)', start: '09:30', end: '18:30', breakMin: 60, active: true },
  { id: 'SILOM-M', storeId: 'SILOM', name: 'เช้า', start: '09:30', end: '18:30', breakMin: 60, active: true },
  { id: 'SILOM-E', storeId: 'SILOM', name: 'เย็น', start: '12:30', end: '21:30', breakMin: 60, active: true },
];

// Staff not linked to LINE yet. Each person picks their nickname when they first open the app,
// then the owner approves. Full name, phone and home store are filled in at that point.
const SEED_STAFF: Staff[] = [
  ['ST-kaew', 'แก้ว'],
  ['ST-muay', 'มวย'],
  ['ST-ammy', 'แอมมี่'],
  ['ST-noon', 'นุ่น'],
  ['ST-mick', 'มิ๊ก'],
].map(([id, nickname]) => ({
  id,
  lineUserId: '',
  lineName: '',
  name: '',
  nickname,
  phone: '',
  role: 'staff',
  storeId: '',
  status: 'active',
  createdAt: '',
}));

/**
 * POST /api/setup  (header: X-Setup-Key: <SETUP_KEY>)
 * Creates missing tabs + headers and seeds the stores, shift templates, staff list and settings.
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

  const d = await load(c.sheets, { staff: true, stores: true, shiftTypes: true, settings: true });
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
  if (!d.staff.length) {
    const h = d.tables[SHEET.staff]!.headers;
    await appendRows(c.sheets, SHEET.staff, h, SEED_STAFF.map((st) => toRow(staffToRec(st), h)));
    seeded.push(`Staff (${SEED_STAFF.length})`);
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
    next: 'เปิดแอปใน LINE แล้วลงทะเบียน "ไม่มีชื่อในรายการ" พร้อมรหัสเจ้าของร้าน (= SETUP_KEY) เพื่อเป็นเจ้าของร้านคนแรก',
  };
}
