import type { DayFlag, Staff } from '@shared/types';

const TZ = 'Asia/Bangkok';
const pad = (n: number) => String(n).padStart(2, '0');

/** Today's date in Bangkok as YYYY-MM-DD. */
export function todayStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
}

export const thisMonth = () => todayStr().slice(0, 7);

const asDate = (d: string) => new Date(`${d}T12:00:00+07:00`);

export function fmtDate(d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return asDate(d).toLocaleDateString('th-TH', { timeZone: TZ, ...opts });
}

export function fmtMonth(month: string): string {
  return asDate(`${month}-15`).toLocaleDateString('th-TH', { timeZone: TZ, month: 'long', year: 'numeric' });
}

export function fmtClock(date: Date): string {
  return date.toLocaleTimeString('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function fmtLongDate(date: Date): string {
  return date.toLocaleDateString('th-TH', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** "2026-11-20T08:41:05+07:00" -> "08:41" */
export const hhmm = (iso?: string) => (iso ? iso.slice(11, 16) : '–');

/** 125 -> "2 ชม. 5 นาที" */
export function fmtMin(min: number): string {
  if (!min) return '0';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} นาที`;
  return m ? `${h} ชม. ${m} นาที` : `${h} ชม.`;
}

/** 3725000 ms -> "01:02:05" (stopwatch) */
export function fmtDuration(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Bangkok date + HH:mm -> epoch ms */
export const bkkMs = (date: string, time: string) => Date.parse(`${date}T${time}:00+07:00`);

/** 125 -> "2:05" */
export const fmtHM = (min: number) => `${Math.floor(min / 60)}:${pad(min % 60)}`;

export const hours2 = (min: number) => (min / 60).toFixed(2);

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

export function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export const staffName = (s?: Pick<Staff, 'name' | 'nickname'>) =>
  !s ? '–' : s.nickname && s.name ? `${s.nickname} · ${s.name}` : s.nickname || s.name || '–';

export const FLAG_LABEL: Record<DayFlag, string> = {
  late: 'สาย',
  early_leave: 'ออกก่อน',
  absent: 'ขาดงาน',
  missing_out: 'ลืมลงเวลาออก',
  missing_in: 'ไม่มีเวลาเข้า',
  unscheduled: 'นอกตาราง',
  upcoming: 'ยังไม่ถึงเวลา',
  not_in_yet: 'ยังไม่เข้างาน',
  in_progress: 'กำลังทำงาน',
  ot: 'OT',
};

export const FLAG_TONE: Record<DayFlag, 'red' | 'amber' | 'green' | 'blue' | 'gray'> = {
  late: 'amber',
  early_leave: 'amber',
  absent: 'red',
  missing_out: 'red',
  missing_in: 'red',
  unscheduled: 'gray',
  upcoming: 'gray',
  not_in_yet: 'amber',
  in_progress: 'green',
  ot: 'blue',
};
