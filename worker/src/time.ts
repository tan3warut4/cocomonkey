// Thailand is UTC+7 all year (no DST), so a fixed offset is safe.
export const TZ_OFFSET_MS = 7 * 3600_000;
export const DAY_MS = 86_400_000;

const pad = (n: number, l = 2) => String(n).padStart(l, '0');

function parts(ms: number) {
  const d = new Date(ms + TZ_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
  };
}

export function bkkDate(ms: number): string {
  const p = parts(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function bkkTime(ms: number): string {
  const p = parts(ms);
  return `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

export function bkkIso(ms: number): string {
  return `${bkkDate(ms)}T${bkkTime(ms)}+07:00`;
}

export function bkkMonth(ms: number): string {
  return bkkDate(ms).slice(0, 7);
}

/** Bangkok wall-clock date + time -> epoch ms. */
export function bkkToMs(date: string, time = '00:00'): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi, s = 0] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, mi, s) - TZ_OFFSET_MS;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((bkkToMs(to) - bkkToMs(from)) / DAY_MS);
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

/** All YYYY-MM months touched by the inclusive date range. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${pad(m)}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    if (out.length > 36) break;
  }
  return out;
}

export const isDateStr = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isMonthStr = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);
export const isTimeStr = (s: unknown): s is string => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);

// ---------- Google Sheets cell parsing ----------
// We read with UNFORMATTED_VALUE + SERIAL_NUMBER, so cells the app wrote (RAW strings)
// come back as strings, and cells the owner typed by hand (dates/times) come back as
// serial numbers (days since 1899-12-30). Both are handled here.

const SERIAL_EPOCH = Date.UTC(1899, 11, 30);

function serialToWallMs(serial: number): number {
  return SERIAL_EPOCH + Math.round(serial * DAY_MS);
}

function fmtYmd(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function cellDate(v: unknown): string {
  if (typeof v === 'number') {
    const t = new Date(serialToWallMs(Math.floor(v)));
    return fmtYmd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  const s = v == null ? '' : String(v).trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return fmtYmd(+m[1], +m[2], +m[3]);
  // Thai sheets usually show D/M/YYYY, sometimes in Buddhist year (2569 = 2026)
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    let y = +m[3];
    if (y > 2400) y -= 543;
    return fmtYmd(y, +m[2], +m[1]);
  }
  return s;
}

export function cellTime(v: unknown): string {
  if (typeof v === 'number') {
    const mins = Math.round((v - Math.floor(v)) * 1440) % 1440;
    return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
  }
  const s = v == null ? '' : String(v).trim();
  const m = s.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (!m) return s;
  let h = +m[1];
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return `${pad(h)}:${m[2]}`;
}

/** Timestamp cell -> epoch ms (strings without offset are treated as Bangkok time). */
export function cellEpoch(v: unknown): number | null {
  if (typeof v === 'number') return serialToWallMs(v) - TZ_OFFSET_MS;
  const s = v == null ? '' : String(v).trim();
  if (!s) return null;
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(?::\d{2})?)$/);
  if (m) return bkkToMs(m[1], m[2]);
  return null;
}
