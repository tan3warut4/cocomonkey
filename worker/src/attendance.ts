// Late / early-leave / break / OT calculation. Pure functions, no I/O (see attendance.test.ts).
//
// Rules (tunable in the Settings tab):
// - A work session = IN, then any BREAK_START/BREAK_END, then OUT (within OPEN_MAX_MS of the IN).
// - A session belongs to the shift whose start is closest to the IN time, when
//   IN is between (shift start - 4h) and shift end. Overnight shifts (end <= start) end the next day.
// - Late: IN later than start + late_grace_min -> late minutes counted from shift start.
// - Break: if the person clocked breaks, the actual break time is deducted; otherwise the
//   scheduled break is deducted. Clocked break longer than scheduled + late_grace_min = "over break".
//   A break still open at OUT ends at OUT.
// - Regular minutes: overlap of [IN, OUT] with [start, end], minus break. Arriving early is not paid.
// - OT: minutes after shift end, counted only if >= ot_min_minutes, rounded down to ot_round_minutes.
// - Sessions with no matching shift are "unscheduled": their minutes (minus clocked breaks) are
//   reported separately for the owner to decide, not added to regular or OT.

import type { DayFlag, DayRecord, Punch, Settings, Shift, StaffSummary } from '../../shared/types';
import { DAY_MS, bkkToMs } from './time';

export const OPEN_MAX_MS = 20 * 3600_000; // an IN older than this without OUT is considered forgotten
const MATCH_BEFORE_MS = 4 * 3600_000; // how early an IN can be and still count for a shift
const MISSING_OUT_AFTER_MS = 4 * 3600_000; // after shift end, no OUT => missing_out

export function shiftStartMs(s: Pick<Shift, 'date' | 'start'>): number {
  return bkkToMs(s.date, s.start);
}

export function shiftEndMs(s: Pick<Shift, 'date' | 'start' | 'end'>): number {
  const start = shiftStartMs(s);
  let end = bkkToMs(s.date, s.end);
  if (end <= start) end += DAY_MS;
  return end;
}

/** The shift a punch at `ms` most likely belongs to. */
export function shiftForTime<T extends Shift>(shifts: T[], ms: number): T | null {
  let best: T | null = null;
  let bestDiff = Infinity;
  for (const s of shifts) {
    const st = shiftStartMs(s);
    if (ms < st - MATCH_BEFORE_MS || ms >= shiftEndMs(s)) continue;
    const diff = Math.abs(ms - st);
    if (diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return best;
}

export interface OpenSession {
  in: Punch;
  rest: Punch[]; // break punches after the IN
  onBreak: Punch | null; // the BREAK_START currently open
}

/** The current work session (clocked in, not yet out), if any. `punches` must be sorted. */
export function currentSession(punches: Punch[], nowMs: number): OpenSession | null {
  for (let i = punches.length - 1; i >= 0; i--) {
    const p = punches[i];
    if (p.type === 'OUT') return null;
    if (p.type === 'IN') {
      if (nowMs - p.ms > OPEN_MAX_MS) return null;
      const rest = punches.slice(i + 1);
      const last = rest[rest.length - 1];
      return { in: p, rest, onBreak: last?.type === 'BREAK_START' ? last : null };
    }
  }
  return null;
}

export function openPunchOf(punches: Punch[], nowMs: number): Punch | null {
  return currentSession(punches, nowMs)?.in ?? null;
}

/** Total clocked break minutes; an open break counts until `endMs`. */
export function breakMinutes(breaks: Punch[], endMs: number): number {
  let total = 0;
  let start: number | null = null;
  for (const p of breaks) {
    if (p.type === 'BREAK_START' && start === null) start = p.ms;
    else if (p.type === 'BREAK_END' && start !== null) {
      total += p.ms - start;
      start = null;
    }
  }
  if (start !== null && endMs > start) total += endMs - start;
  return Math.floor(total / 60_000);
}

export function lateMinutes(inMs: number, startMs: number, s: Settings): number {
  const diff = inMs - startMs;
  return diff > s.lateGraceMin * 60_000 ? Math.ceil(diff / 60_000) : 0;
}

export function otMinutes(outMs: number, endMs: number, s: Settings): number {
  const raw = Math.floor((outMs - endMs) / 60_000);
  if (raw < s.otMinMin) return 0;
  return Math.floor(raw / s.otRoundMin) * s.otRoundMin;
}

interface Session {
  in?: Punch;
  out?: Punch;
  breaks: Punch[];
  used: boolean;
}

function buildSessions(punches: Punch[]): Session[] {
  const out: Session[] = [];
  let open: Session | null = null;
  for (const p of punches) {
    if (p.type === 'IN') {
      if (open) out.push(open); // previous IN never closed
      open = { in: p, breaks: [], used: false };
    } else if (p.type === 'BREAK_START' || p.type === 'BREAK_END') {
      if (open && p.ms - open.in!.ms <= OPEN_MAX_MS) open.breaks.push(p); // breaks outside a session are ignored
    } else if (open && p.ms - open.in!.ms <= OPEN_MAX_MS) {
      open.out = p;
      out.push(open);
      open = null;
    } else {
      if (open) out.push(open);
      open = null;
      out.push({ out: p, breaks: [], used: false }); // OUT with no IN
    }
  }
  if (open) out.push(open);
  return out;
}

export interface CalcInput {
  staffIds: string[];
  shifts: Shift[];
  punches: Punch[];
  settings: Settings;
  from: string; // inclusive YYYY-MM-DD
  to: string; // inclusive YYYY-MM-DD
  nowMs: number;
  shiftNames?: Map<string, string>; // shiftTypeId -> name
}

export function calcDays(input: CalcInput): DayRecord[] {
  const { settings: st, from, to, nowMs } = input;
  const records: DayRecord[] = [];

  for (const staffId of input.staffIds) {
    const punches = input.punches.filter((p) => p.staffId === staffId).sort((a, b) => a.ms - b.ms);
    const sessions = buildSessions(punches);
    const shifts = input.shifts
      .filter((s) => s.staffId === staffId && s.date >= from && s.date <= to)
      .sort((a, b) => shiftStartMs(a) - shiftStartMs(b));

    for (const sh of shifts) {
      const startMs = shiftStartMs(sh);
      const endMs = shiftEndMs(sh);
      let sess: Session | null = null;
      let bestDiff = Infinity;
      for (const s of sessions) {
        if (s.used || !s.in) continue;
        if (s.in.ms < startMs - MATCH_BEFORE_MS || s.in.ms >= endMs) continue;
        const diff = Math.abs(s.in.ms - startMs);
        if (diff < bestDiff) {
          sess = s;
          bestDiff = diff;
        }
      }

      const rec: DayRecord = {
        date: sh.date,
        staffId,
        storeId: sh.storeId,
        shiftId: sh.id,
        shiftName: input.shiftNames?.get(sh.shiftTypeId) ?? 'กะ',
        schedStart: sh.start,
        schedEnd: sh.end,
        breakMin: sh.breakMin,
        lateMin: 0,
        earlyLeaveMin: 0,
        regularMin: 0,
        otMin: 0,
        unscheduledMin: 0,
        overBreakMin: 0,
        flags: [],
      };

      if (!sess || !sess.in) {
        rec.flags.push(nowMs < startMs ? 'upcoming' : nowMs < endMs ? 'not_in_yet' : 'absent');
        records.push(rec);
        continue;
      }

      sess.used = true;
      const inMs = sess.in.ms;
      rec.inTs = sess.in.ts;
      rec.inStoreId = sess.in.storeId;
      rec.lateMin = lateMinutes(inMs, startMs, st);
      if (rec.lateMin > 0) rec.flags.push('late');

      const hasBreaks = sess.breaks.length > 0;
      if (hasBreaks) {
        rec.breakTakenMin = breakMinutes(sess.breaks, sess.out?.ms ?? nowMs);
        const over = rec.breakTakenMin - sh.breakMin;
        if (over > st.lateGraceMin) {
          rec.overBreakMin = over;
          rec.flags.push('over_break');
        }
      }

      if (sess.out) {
        const outMs = sess.out.ms;
        rec.outTs = sess.out.ts;
        const early = Math.floor((endMs - outMs) / 60_000);
        if (early > 0) {
          rec.earlyLeaveMin = early;
          rec.flags.push('early_leave');
        }
        const overlap = (Math.min(outMs, endMs) - Math.max(inMs, startMs)) / 60_000;
        const deduct = hasBreaks ? rec.breakTakenMin! : sh.breakMin;
        rec.regularMin = Math.max(0, Math.floor(overlap) - deduct);
        rec.otMin = otMinutes(outMs, endMs, st);
        if (rec.otMin > 0) rec.flags.push('ot');
      } else if (nowMs > endMs + MISSING_OUT_AFTER_MS) {
        rec.flags.push('missing_out');
      } else {
        const last = sess.breaks[sess.breaks.length - 1];
        rec.flags.push(last?.type === 'BREAK_START' ? 'on_break' : 'in_progress');
      }
      records.push(rec);
    }

    // Sessions that matched no shift
    for (const s of sessions) {
      if (s.used) continue;
      const anchor = s.in ?? s.out!;
      if (anchor.date < from || anchor.date > to) continue;
      const flags: DayFlag[] = ['unscheduled'];
      let minutes = 0;
      let breakTakenMin: number | undefined;
      if (s.breaks.length) breakTakenMin = breakMinutes(s.breaks, s.out?.ms ?? nowMs);
      if (s.in && s.out) minutes = Math.max(0, Math.floor((s.out.ms - s.in.ms) / 60_000) - (breakTakenMin ?? 0));
      else if (s.in) flags.push(nowMs - s.in.ms > OPEN_MAX_MS ? 'missing_out' : 'in_progress');
      else flags.push('missing_in');
      records.push({
        date: anchor.date,
        staffId,
        storeId: anchor.storeId,
        inTs: s.in?.ts,
        outTs: s.out?.ts,
        inStoreId: s.in?.storeId,
        breakTakenMin,
        lateMin: 0,
        earlyLeaveMin: 0,
        regularMin: 0,
        otMin: 0,
        unscheduledMin: minutes,
        overBreakMin: 0,
        flags,
      });
    }
  }

  return records.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.staffId.localeCompare(b.staffId) ||
      (a.schedStart ?? a.inTs ?? '').localeCompare(b.schedStart ?? b.inTs ?? ''),
  );
}

export function summarize(days: DayRecord[], staff: { id: string; name: string }[]): StaffSummary[] {
  return staff.map((s) => {
    const mine = days.filter((d) => d.staffId === s.id);
    const sum: StaffSummary = {
      staffId: s.id,
      name: s.name,
      scheduled: 0,
      attended: 0,
      absent: 0,
      lateCount: 0,
      lateMin: 0,
      earlyLeaveMin: 0,
      regularMin: 0,
      otMin: 0,
      unscheduledMin: 0,
      missingPunch: 0,
      overBreakCount: 0,
      overBreakMin: 0,
    };
    for (const d of mine) {
      if (d.shiftId && !d.flags.includes('upcoming')) sum.scheduled++;
      if (d.shiftId && d.inTs) sum.attended++;
      if (d.flags.includes('absent')) sum.absent++;
      if (d.lateMin > 0) sum.lateCount++;
      sum.lateMin += d.lateMin;
      sum.earlyLeaveMin += d.earlyLeaveMin;
      sum.regularMin += d.regularMin;
      sum.otMin += d.otMin;
      sum.unscheduledMin += d.unscheduledMin;
      if (d.overBreakMin > 0) sum.overBreakCount++;
      sum.overBreakMin += d.overBreakMin;
      if (d.flags.includes('missing_out') || d.flags.includes('missing_in')) sum.missingPunch++;
    }
    return sum;
  });
}
