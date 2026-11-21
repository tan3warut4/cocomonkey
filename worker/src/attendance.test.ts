import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Punch, Settings, Shift } from '../../shared/types';
import { breakMinutes, calcDays, currentSession, openPunchOf, summarize } from './attendance';
import { bkkDate, bkkIso, bkkTime, bkkToMs, cellDate, cellEpoch, cellTime, monthsBetween, weekStart } from './time';

const S: Settings = { lateGraceMin: 5, otMinMin: 30, otRoundMin: 15, maxAccuracyM: 100 };
const D = '2026-11-20';

function shift(date: string, start: string, end: string, id = `sh-${date}-${start}`): Shift {
  return { id, date, staffId: 'A', storeId: 'S1', shiftTypeId: 'S1-M', start, end, breakMin: 60, note: '' };
}
function p(date: string, time: string, type: Punch['type']): Punch {
  const ms = bkkToMs(date, time);
  return {
    id: `${type}-${date}-${time}`,
    ms,
    ts: bkkIso(ms),
    date: bkkDate(ms),
    time: bkkTime(ms),
    staffId: 'A',
    storeId: 'S1',
    type,
    lat: 0,
    lng: 0,
    accuracyM: 10,
    distanceM: 5,
  };
}
const AFTER = bkkToMs('2026-11-25', '12:00');
const run = (shifts: Shift[], punches: Punch[], nowMs = AFTER, from = D, to = D) =>
  calcDays({ staffIds: ['A'], shifts, punches, settings: S, from, to, nowMs });

test('on time, small overtime is ignored', () => {
  const [r] = run([shift(D, '08:30', '17:30')], [p(D, '08:28', 'IN'), p(D, '17:35', 'OUT')]);
  assert.equal(r.lateMin, 0);
  assert.equal(r.regularMin, 480); // 9h - 1h break
  assert.equal(r.otMin, 0); // 5 min < 30 min minimum
  assert.deepEqual(r.flags, []);
});

test('late within grace is not late; beyond grace counts from shift start', () => {
  assert.equal(run([shift(D, '08:30', '17:30')], [p(D, '08:35', 'IN'), p(D, '17:30', 'OUT')])[0].lateMin, 0);
  const [r] = run([shift(D, '08:30', '17:30')], [p(D, '08:36', 'IN'), p(D, '17:30', 'OUT')]);
  assert.equal(r.lateMin, 6);
  assert.ok(r.flags.includes('late'));
  assert.equal(r.regularMin, 474);
});

test('OT rounds down to 15-minute blocks', () => {
  const [r] = run([shift(D, '08:30', '17:30')], [p(D, '08:30', 'IN'), p(D, '18:20', 'OUT')]);
  assert.equal(r.otMin, 45); // 50 -> 45
  assert.equal(r.regularMin, 480);
  assert.ok(r.flags.includes('ot'));
});

test('early leave', () => {
  const [r] = run([shift(D, '08:30', '17:30')], [p(D, '08:30', 'IN'), p(D, '17:00', 'OUT')]);
  assert.equal(r.earlyLeaveMin, 30);
  assert.equal(r.regularMin, 450);
  assert.ok(r.flags.includes('early_leave'));
});

test('absent, upcoming and not-yet-in', () => {
  const sh = [shift(D, '08:30', '17:30')];
  assert.deepEqual(run(sh, [])[0].flags, ['absent']);
  assert.deepEqual(run(sh, [], bkkToMs(D, '07:00'))[0].flags, ['upcoming']);
  assert.deepEqual(run(sh, [], bkkToMs(D, '09:00'))[0].flags, ['not_in_yet']);
});

test('missing OUT vs still working', () => {
  const sh = [shift(D, '08:30', '17:30')];
  assert.ok(run(sh, [p(D, '08:30', 'IN')])[0].flags.includes('missing_out'));
  assert.ok(run(sh, [p(D, '08:30', 'IN')], bkkToMs(D, '16:00'))[0].flags.includes('in_progress'));
});

test('overnight shift ends next day', () => {
  const [r] = run([shift(D, '20:00', '04:00')], [p(D, '19:55', 'IN'), p('2026-11-21', '04:40', 'OUT')]);
  assert.equal(r.lateMin, 0);
  assert.equal(r.regularMin, 420); // 8h - 1h
  assert.equal(r.otMin, 30); // 40 -> 30
});

test('punches without a shift are unscheduled', () => {
  const [r] = run([], [p(D, '10:00', 'IN'), p(D, '14:15', 'OUT')]);
  assert.deepEqual(r.flags, ['unscheduled']);
  assert.equal(r.unscheduledMin, 255);
  assert.equal(r.regularMin, 0);
});

test('two shifts in a range match the right sessions', () => {
  const d2 = '2026-11-21';
  const days = run(
    [shift(D, '08:30', '17:30'), shift(d2, '12:30', '21:30')],
    [p(D, '08:40', 'IN'), p(D, '17:30', 'OUT'), p(d2, '12:25', 'IN'), p(d2, '22:05', 'OUT')],
    AFTER,
    D,
    d2,
  );
  assert.equal(days.length, 2);
  assert.equal(days[0].lateMin, 10);
  assert.equal(days[1].lateMin, 0);
  assert.equal(days[1].otMin, 30); // 35 -> 30
  const [sum] = summarize(days, [{ id: 'A', name: 'A' }]);
  assert.equal(sum.scheduled, 2);
  assert.equal(sum.attended, 2);
  assert.equal(sum.lateCount, 1);
  assert.equal(sum.otMin, 30);
});

test('open punch detection', () => {
  const ins = [p(D, '08:30', 'IN')];
  assert.ok(openPunchOf(ins, bkkToMs(D, '12:00')));
  assert.equal(openPunchOf(ins, bkkToMs('2026-11-21', '06:00')), null); // > 20h old
  assert.equal(openPunchOf([...ins, p(D, '17:30', 'OUT')], bkkToMs(D, '18:00')), null);
});

test('sheet cell parsing', () => {
  assert.equal(cellDate(45658), '2025-01-01'); // serial number
  assert.equal(cellDate('20/11/2569'), '2026-11-20'); // Thai Buddhist year
  assert.equal(cellDate('2026-11-20'), '2026-11-20');
  assert.equal(cellTime(0.5), '12:00');
  assert.equal(cellTime(45658.375), '09:00');
  assert.equal(cellTime('9:05'), '09:05');
  assert.equal(cellTime('5:30 PM'), '17:30');
  assert.equal(cellEpoch('2026-11-20T08:00:00+07:00'), Date.UTC(2026, 10, 20, 1));
  assert.equal(cellEpoch('2026-11-20 08:00'), Date.UTC(2026, 10, 20, 1));
  assert.equal(cellEpoch(45658.375), Date.UTC(2025, 0, 1, 2)); // 09:00 Bangkok
});

test('date helpers', () => {
  assert.equal(weekStart('2026-11-20'), '2026-11-16'); // Friday -> Monday
  assert.equal(weekStart('2026-11-22'), '2026-11-16'); // Sunday -> Monday
  assert.deepEqual(monthsBetween('2026-11-30', '2027-01-01'), ['2026-11', '2026-12', '2027-01']);
  assert.equal(bkkDate(Date.UTC(2026, 10, 19, 17, 30)), '2026-11-20'); // 00:30 Bangkok
});

test('clocked break shorter than scheduled: actual break is deducted', () => {
  const [r] = run([shift(D, '08:30', '17:30')], [p(D, '08:30', 'IN'), p(D, '12:00', 'BREAK_START'), p(D, '12:45', 'BREAK_END'), p(D, '17:30', 'OUT')]);
  assert.equal(r.breakTakenMin, 45);
  assert.equal(r.regularMin, 495);
  assert.equal(r.overBreakMin, 0);
  assert.deepEqual(r.flags, []);
});

test('over break is flagged beyond the grace minutes', () => {
  const ok = run([shift(D, '08:30', '17:30')], [p(D, '08:30', 'IN'), p(D, '12:00', 'BREAK_START'), p(D, '13:05', 'BREAK_END'), p(D, '17:30', 'OUT')])[0];
  assert.equal(ok.overBreakMin, 0); // 65 min = within 5 min grace
  const [r] = run([shift(D, '08:30', '17:30')], [p(D, '08:30', 'IN'), p(D, '12:00', 'BREAK_START'), p(D, '13:10', 'BREAK_END'), p(D, '17:30', 'OUT')]);
  assert.equal(r.breakTakenMin, 70);
  assert.equal(r.overBreakMin, 10);
  assert.equal(r.regularMin, 470);
  assert.ok(r.flags.includes('over_break'));
  const [sum] = summarize([r], [{ id: 'A', name: 'A' }]);
  assert.equal(sum.overBreakCount, 1);
  assert.equal(sum.overBreakMin, 10);
});

test('two breaks add up; a break left open ends at OUT', () => {
  const [r] = run(
    [shift(D, '08:30', '17:30')],
    [p(D, '08:30', 'IN'), p(D, '10:00', 'BREAK_START'), p(D, '10:15', 'BREAK_END'), p(D, '16:45', 'BREAK_START'), p(D, '17:30', 'OUT')],
  );
  assert.equal(r.breakTakenMin, 60);
  assert.equal(r.regularMin, 480);
});

test('on break right now, and session state', () => {
  const punches = [p(D, '08:30', 'IN'), p(D, '12:00', 'BREAK_START')];
  const now = bkkToMs(D, '12:20');
  const [r] = run([shift(D, '08:30', '17:30')], punches, now);
  assert.ok(r.flags.includes('on_break'));
  assert.equal(r.breakTakenMin, 20);
  const s = currentSession(punches, now)!;
  assert.equal(s.in.time, '08:30:00');
  assert.equal(s.onBreak?.time, '12:00:00');
  assert.equal(openPunchOf(punches, now)?.type, 'IN');
  const back = currentSession([...punches, p(D, '13:00', 'BREAK_END')], bkkToMs(D, '13:05'))!;
  assert.equal(back.onBreak, null);
  assert.equal(breakMinutes(back.rest, bkkToMs(D, '13:05')), 60);
});

test('break punches outside a work session are ignored', () => {
  const [r] = run([shift(D, '08:30', '17:30')], [p(D, '07:00', 'BREAK_START'), p(D, '08:30', 'IN'), p(D, '17:30', 'OUT')]);
  assert.equal(r.breakTakenMin, undefined);
  assert.equal(r.regularMin, 480); // scheduled break deducted
});

test('unscheduled session subtracts clocked breaks', () => {
  const [r] = run([], [p(D, '10:00', 'IN'), p(D, '12:00', 'BREAK_START'), p(D, '12:30', 'BREAK_END'), p(D, '14:00', 'OUT')]);
  assert.equal(r.unscheduledMin, 210);
});
