import type { Punch, Settings, Shift, ShiftType, Staff, Store } from '../../shared/types';
import { bkkDate, bkkIso, bkkTime, bkkToMs, cellDate, cellEpoch, cellTime } from './time';
import { bool, num, str } from './util';

export const SHEET = {
  stores: 'Stores',
  staff: 'Staff',
  shiftTypes: 'ShiftTypes',
  shifts: 'Shifts',
  settings: 'Settings',
} as const;

export type CoreSheet = (typeof SHEET)[keyof typeof SHEET];

/** One attendance tab per month keeps each read small, e.g. "Attendance_2026-11". */
export const attendanceSheet = (month: string) => `Attendance_${month}`;

export const HEADERS: Record<CoreSheet | 'Attendance', string[]> = {
  Stores: ['id', 'name', 'lat', 'lng', 'radius_m', 'active'],
  Staff: ['id', 'line_user_id', 'line_name', 'name', 'nickname', 'phone', 'role', 'store_id', 'status', 'created_at'],
  ShiftTypes: ['id', 'store_id', 'name', 'start', 'end', 'break_min', 'active'],
  Shifts: ['id', 'date', 'staff_id', 'store_id', 'shift_type_id', 'start', 'end', 'break_min', 'note', 'updated_at'],
  Settings: ['key', 'value', 'description'],
  Attendance: [
    'id',
    'timestamp',
    'date',
    'time',
    'staff_id',
    'staff_name',
    'store_id',
    'store_name',
    'type',
    'lat',
    'lng',
    'accuracy_m',
    'distance_m',
    'note',
  ],
};

export type Rec = Record<string, unknown>;

export interface Table {
  headers: string[];
  rows: { row: number; data: Rec }[]; // row = 1-based sheet row number
  emptyRows: number[]; // blank rows between data (reusable)
}

export function parseTable(values: unknown[][], fallbackHeaders: string[]): Table {
  const first = values[0] ?? [];
  const headers = first.some((h) => str(h)) ? first.map((h) => str(h)) : fallbackHeaders;
  const rows: Table['rows'] = [];
  const emptyRows: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i] ?? [];
    if (!r.some((c) => str(c) !== '')) {
      emptyRows.push(i + 1);
      continue;
    }
    const data: Rec = {};
    headers.forEach((h, j) => {
      if (h) data[h] = r[j];
    });
    rows.push({ row: i + 1, data });
  }
  return { headers, rows, emptyRows };
}

export function toRow(rec: Rec, headers: string[]): unknown[] {
  return headers.map((h) => {
    const v = rec[h];
    return v === undefined || v === null ? '' : v;
  });
}

// ---------- sheet row -> typed ----------

export function toStore(r: Rec): Store | null {
  const id = str(r.id);
  if (!id) return null;
  return {
    id,
    name: str(r.name) || id,
    lat: num(r.lat),
    lng: num(r.lng),
    radiusM: num(r.radius_m, 150),
    active: bool(r.active),
  };
}

export function toStaff(r: Rec): Staff | null {
  const id = str(r.id);
  if (!id) return null;
  const role = str(r.role).toLowerCase() === 'owner' ? 'owner' : 'staff';
  const st = str(r.status).toLowerCase();
  const status = st === 'active' || st === 'inactive' ? st : 'pending';
  return {
    id,
    lineUserId: str(r.line_user_id),
    lineName: str(r.line_name),
    name: str(r.name),
    nickname: str(r.nickname),
    phone: str(r.phone),
    role,
    storeId: str(r.store_id),
    status,
    createdAt: str(r.created_at),
  };
}

export function toShiftType(r: Rec): ShiftType | null {
  const id = str(r.id);
  const start = cellTime(r.start);
  const end = cellTime(r.end);
  if (!id || !start || !end) return null;
  return {
    id,
    storeId: str(r.store_id),
    name: str(r.name) || id,
    start,
    end,
    breakMin: num(r.break_min, 0),
    active: bool(r.active),
  };
}

export function toShift(r: Rec, row: number): Shift | null {
  const date = cellDate(r.date);
  const staffId = str(r.staff_id);
  const start = cellTime(r.start);
  const end = cellTime(r.end);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !staffId || !start || !end) return null;
  return {
    id: str(r.id) || `row${row}`,
    date,
    staffId,
    storeId: str(r.store_id),
    shiftTypeId: str(r.shift_type_id),
    start,
    end,
    breakMin: num(r.break_min, 0),
    note: str(r.note),
  };
}

export function toPunch(r: Rec, row: number): Punch | null {
  const type = str(r.type).toUpperCase();
  const staffId = str(r.staff_id);
  if ((type !== 'IN' && type !== 'OUT') || !staffId) return null;
  let ms = cellEpoch(r.timestamp);
  if (ms == null) {
    const d = cellDate(r.date);
    const t = cellTime(r.time);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && /^\d{2}:\d{2}$/.test(t)) ms = bkkToMs(d, t);
  }
  if (ms == null) return null;
  return {
    id: str(r.id) || `row${row}`,
    ms,
    ts: bkkIso(ms),
    date: bkkDate(ms),
    time: bkkTime(ms),
    staffId,
    storeId: str(r.store_id),
    type,
    lat: num(r.lat),
    lng: num(r.lng),
    accuracyM: num(r.accuracy_m),
    distanceM: num(r.distance_m),
  };
}

export const DEFAULT_SETTINGS: Settings = {
  lateGraceMin: 5,
  otMinMin: 30,
  otRoundMin: 15,
  maxAccuracyM: 100,
};

export const SETTING_ROWS: { key: string; field: keyof Settings; description: string }[] = [
  {
    key: 'late_grace_min',
    field: 'lateGraceMin',
    description: 'เข้างานช้ากว่าเวลาเริ่มกะเกินกี่นาทีจึงนับว่าสาย (ถ้าสาย จะนับนาทีตั้งแต่เวลาเริ่มกะ)',
  },
  { key: 'ot_min_minutes', field: 'otMinMin', description: 'ทำงานเกินเวลาเลิกกะอย่างน้อยกี่นาทีจึงนับเป็น OT' },
  { key: 'ot_round_minutes', field: 'otRoundMin', description: 'ปัด OT ลงเป็นช่วงละกี่นาที (เช่น 15 = ปัดลงทีละ 15 นาที)' },
  {
    key: 'max_gps_accuracy_m',
    field: 'maxAccuracyM',
    description: 'ไม่รับการลงเวลาถ้า GPS คลาดเคลื่อนเกินกี่เมตร',
  },
];

export function toSettings(rows: Rec[]): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    const def = SETTING_ROWS.find((d) => d.key === str(r.key));
    if (def) s[def.field] = num(r.value, DEFAULT_SETTINGS[def.field]);
  }
  if (s.otRoundMin < 1) s.otRoundMin = 1;
  return s;
}

// ---------- typed -> sheet record ----------

export function staffToRec(s: Staff): Rec {
  return {
    id: s.id,
    line_user_id: s.lineUserId,
    line_name: s.lineName,
    name: s.name,
    nickname: s.nickname,
    phone: s.phone,
    role: s.role,
    store_id: s.storeId,
    status: s.status,
    created_at: s.createdAt,
  };
}

export function storeToRec(s: Store): Rec {
  return { id: s.id, name: s.name, lat: s.lat, lng: s.lng, radius_m: s.radiusM, active: s.active };
}

export function shiftTypeToRec(t: ShiftType): Rec {
  return {
    id: t.id,
    store_id: t.storeId,
    name: t.name,
    start: t.start,
    end: t.end,
    break_min: t.breakMin,
    active: t.active,
  };
}

export function shiftToRec(s: Shift, updatedAt: string): Rec {
  return {
    id: s.id,
    date: s.date,
    staff_id: s.staffId,
    store_id: s.storeId,
    shift_type_id: s.shiftTypeId,
    start: s.start,
    end: s.end,
    break_min: s.breakMin,
    note: s.note,
    updated_at: updatedAt,
  };
}

export function punchToRec(p: Punch, staffName: string, storeName: string): Rec {
  return {
    id: p.id,
    timestamp: p.ts,
    date: p.date,
    time: p.time,
    staff_id: p.staffId,
    staff_name: staffName,
    store_id: p.storeId,
    store_name: storeName,
    type: p.type,
    lat: p.lat,
    lng: p.lng,
    accuracy_m: p.accuracyM,
    distance_m: p.distanceM,
    note: '',
  };
}
