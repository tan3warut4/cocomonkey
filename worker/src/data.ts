import type { Punch, Settings, Shift, ShiftType, Staff, Store } from '../../shared/types';
import {
  HEADERS,
  SHEET,
  type CoreSheet,
  type Rec,
  type Table,
  attendanceSheet,
  parseTable,
  toPunch,
  toRow,
  toSettings,
  toShift,
  toShiftType,
  toStaff,
  toStore,
} from './schema';
import { Sheets, SheetsError, quoteRange } from './sheets';
import { HttpError, colLetter } from './util';

export interface LoadSpec {
  staff?: boolean;
  stores?: boolean;
  shiftTypes?: boolean;
  shifts?: boolean;
  settings?: boolean;
  /** YYYY-MM months of attendance to read (missing tabs are skipped). */
  months?: string[];
}

export interface Loaded {
  tables: Partial<Record<string, Table>>;
  staff: Staff[];
  stores: Store[];
  shiftTypes: ShiftType[];
  shifts: Shift[];
  settings: Settings;
  punches: Punch[]; // sorted by time
  /** sheet row number by entity id, per core sheet */
  rowOf: Record<'staff' | 'stores' | 'shifts', Map<string, number>>;
  /** raw sheet record by entity id (to keep extra columns the owner added) */
  recOf: Record<'staff' | 'stores' | 'shifts', Map<string, Rec>>;
}

const fullRange = (name: string) => quoteRange(name, 'A1:Z');

/** Read everything a request needs in a single Sheets API call. */
export async function load(sheets: Sheets, spec: LoadSpec): Promise<Loaded> {
  const core: CoreSheet[] = [];
  if (spec.staff) core.push(SHEET.staff);
  if (spec.stores) core.push(SHEET.stores);
  if (spec.shiftTypes) core.push(SHEET.shiftTypes);
  if (spec.shifts) core.push(SHEET.shifts);
  if (spec.settings) core.push(SHEET.settings);
  let att = [...new Set(spec.months ?? [])].map(attendanceSheet);

  let values: unknown[][][];
  try {
    values = await sheets.batchGet([...core, ...att].map(fullRange));
  } catch (e) {
    if (!(e instanceof SheetsError && e.isMissingRange)) throw e;
    // Some tab doesn't exist yet (usually a new month). Check which ones exist and retry.
    const titles = await sheets.titles();
    const missing = core.filter((n) => !titles.has(n));
    if (missing.length) {
      throw new HttpError(500, `ยังไม่ได้ตั้งค่า Google Sheet (ไม่พบแท็บ ${missing.join(', ')}) — เรียก /api/setup ก่อน`);
    }
    att = att.filter((n) => titles.has(n));
    values = await sheets.batchGet([...core, ...att].map(fullRange));
  }

  const out: Loaded = {
    tables: {},
    staff: [],
    stores: [],
    shiftTypes: [],
    shifts: [],
    settings: toSettings([]),
    punches: [],
    rowOf: { staff: new Map(), stores: new Map(), shifts: new Map() },
    recOf: { staff: new Map(), stores: new Map(), shifts: new Map() },
  };

  core.forEach((name, i) => {
    const t = parseTable(values[i], HEADERS[name]);
    out.tables[name] = t;
    for (const { row, data } of t.rows) {
      if (name === SHEET.staff) {
        const s = toStaff(data);
        if (s) {
          out.staff.push(s);
          out.rowOf.staff.set(s.id, row);
          out.recOf.staff.set(s.id, data);
        }
      } else if (name === SHEET.stores) {
        const s = toStore(data);
        if (s) {
          out.stores.push(s);
          out.rowOf.stores.set(s.id, row);
          out.recOf.stores.set(s.id, data);
        }
      } else if (name === SHEET.shiftTypes) {
        const s = toShiftType(data);
        if (s) out.shiftTypes.push(s);
      } else if (name === SHEET.shifts) {
        const s = toShift(data, row);
        if (s) {
          out.shifts.push(s);
          out.rowOf.shifts.set(s.id, row);
          out.recOf.shifts.set(s.id, data);
        }
      }
    }
    if (name === SHEET.settings) out.settings = toSettings(t.rows.map((r) => r.data));
  });

  att.forEach((name, j) => {
    const t = parseTable(values[core.length + j], HEADERS.Attendance);
    out.tables[name] = t;
    for (const { row, data } of t.rows) {
      const p = toPunch(data, row);
      if (p) out.punches.push(p);
    }
  });
  out.punches.sort((a, b) => a.ms - b.ms);
  return out;
}

export function rowRange(sheet: string, headers: string[], row: number): string {
  return quoteRange(sheet, `A${row}:${colLetter(headers.length)}${row}`);
}

/** Overwrite one row, keeping any extra columns the owner added by hand. */
export async function writeRow(
  sheets: Sheets,
  sheet: string,
  table: Table,
  row: number,
  rec: Rec,
  existing?: Rec,
): Promise<void> {
  const merged = { ...(existing ?? {}), ...rec };
  await sheets.update([{ range: rowRange(sheet, table.headers, row), values: [toRow(merged, table.headers)] }]);
}

/** Create a tab with a header row if it doesn't exist yet. */
export async function ensureSheet(sheets: Sheets, name: string, headers: string[]): Promise<boolean> {
  try {
    await sheets.addSheet(name);
  } catch (e) {
    if (e instanceof SheetsError && e.isAlreadyExists) return false;
    throw e;
  }
  await sheets.update([{ range: quoteRange(name, 'A1'), values: [headers] }]);
  return true;
}

/** Append rows; creates the tab (e.g. a new month) on first use. */
export async function appendRows(sheets: Sheets, sheet: string, headers: string[], rows: unknown[][]): Promise<void> {
  try {
    await sheets.append(sheet, rows);
  } catch (e) {
    if (!(e instanceof SheetsError && e.isMissingRange)) throw e;
    await ensureSheet(sheets, sheet, headers);
    await sheets.append(sheet, rows);
  }
}
