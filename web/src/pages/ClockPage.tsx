import type { MeResponse, Punch, PunchType } from '@shared/types';
import { useCallback, useEffect, useState } from 'react';
import { Card, PinIcon, RefreshIcon } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { bkkMs, fmtClock, fmtDuration, fmtLongDate, fmtMin, hhmm, staffName } from '../lib/format';
import { type Position, fmtDistance, getPosition, nearestStore } from '../lib/geo';

/** Clocked break time in ms; an open break counts until `endMs`. */
function breakMsOf(ps: Punch[], endMs: number): number {
  let total = 0;
  let start: number | null = null;
  for (const p of ps) {
    if (p.type === 'BREAK_START' && start === null) start = p.ms;
    else if (p.type === 'BREAK_END' && start !== null) {
      total += p.ms - start;
      start = null;
    }
  }
  if (start !== null && endMs > start) total += endMs - start;
  return total;
}

const PUNCH_LABEL: Record<PunchType, string> = { IN: 'เข้า', OUT: 'ออก', BREAK_START: 'พัก', BREAK_END: 'กลับ' };
const PUNCH_BADGE: Record<PunchType, string> = {
  IN: 'badge-green',
  OUT: 'badge-brown',
  BREAK_START: 'badge-amber',
  BREAK_END: 'badge-blue',
};

type GeoState =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'ok'; pos: Position }
  | { kind: 'error'; message: string };

export default function ClockPage({ me, setMe }: { me: MeResponse; setMe: (m: MeResponse) => void }) {
  const [now, setNow] = useState(() => new Date());
  const [geo, setGeo] = useState<GeoState>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  // Phone clocks can be off; measure elapsed time against the server's clock.
  const [offsetMs] = useState(() => {
    const t = Date.parse(me.serverTime);
    return Number.isNaN(t) ? 0 : t - Date.now();
  });

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const locate = useCallback(async (): Promise<Position | null> => {
    setGeo({ kind: 'locating' });
    try {
      const pos = await getPosition();
      setGeo({ kind: 'ok', pos });
      return pos;
    } catch (e) {
      setGeo({ kind: 'error', message: errMsg(e) });
      return null;
    }
  }, []);

  useEffect(() => {
    void locate();
  }, [locate]);

  const storeName = (id: string) => me.stores.find((s) => s.id === id)?.name ?? id;
  const shiftName = (id: string) => me.shiftTypes.find((t) => t.id === id)?.name ?? 'กะ';
  const near = geo.kind === 'ok' ? nearestStore(me.stores, geo.pos) : null;
  const inside = !!near && near.distanceM <= near.store.radiusM;

  // Live work / break timers while clocked in
  const serverNow = now.getTime() + offsetMs;
  const open = me.openPunch;
  const lastSession = (me.sessionPunches ?? [])[(me.sessionPunches ?? []).length - 1];
  const onBreak = lastSession?.type === 'BREAK_START' ? lastSession : null;
  const breakMs = open ? breakMsOf((me.sessionPunches ?? []), serverNow) : 0;
  const workMs = open ? serverNow - open.ms - breakMs : 0;
  const openShift = open
    ? [...me.todayShifts, ...me.upcomingShifts].find((s) => {
        const st = bkkMs(s.date, s.start);
        let en = bkkMs(s.date, s.end);
        if (en <= st) en += 86_400_000;
        return open.ms >= st - 4 * 3_600_000 && open.ms < en;
      })
    : undefined;
  let shiftNote = '';
  if (openShift) {
    const st = bkkMs(openShift.date, openShift.start);
    let en = bkkMs(openShift.date, openShift.end);
    if (en <= st) en += 86_400_000;
    const left = Math.round((en - serverNow) / 60_000);
    shiftNote = left > 0 ? `เลิกกะ ${openShift.end} น. · อีก ${fmtMin(left)}` : `เลยเวลาเลิกกะ ${fmtMin(-left)}`;
  }

  const breakAllowed = openShift?.breakMin ?? 0;
  const breakLeftMin = breakAllowed - Math.floor(breakMs / 60_000);

  async function doPunch(type: PunchType) {
    setBusy(true);
    setResult(null);
    try {
      let body: { type: PunchType; lat?: number; lng?: number; accuracy?: number } = { type };
      if (type === 'IN' || type === 'OUT') {
        const pos = await locate(); // clock in/out always uses a fresh position
        if (!pos) throw new Error('ไม่พบตำแหน่ง กรุณาลองใหม่');
        body = { type, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy };
      } else if (geo.kind === 'ok') {
        // Breaks don't need to be in the store; send the last known position if we have one
        body = { type, lat: geo.pos.lat, lng: geo.pos.lng, accuracy: geo.pos.accuracy };
      }
      const r = await api.punch(body);
      navigator.vibrate?.(60);
      setResult({ ok: true, text: r.message });
      const t = r.punch.type;
      setMe({
        ...me,
        openPunch: t === 'IN' ? r.punch : t === 'OUT' ? null : me.openPunch,
        sessionPunches: t === 'IN' || t === 'OUT' ? [] : [...(me.sessionPunches ?? []), r.punch],
        todayPunches: [...me.todayPunches, r.punch],
      });
    } catch (e) {
      setResult({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="hello">
        <div className="muted">สวัสดี</div>
        <div className="hello-name">{staffName(me.me!)}</div>
      </div>

      <div className="clock">
        <div className="clock-time">{fmtClock(now)}</div>
        <div className="clock-date">{fmtLongDate(now)}</div>
      </div>

      <Card title="กะวันนี้">
        {me.todayShifts.length === 0 ? (
          <p className="muted">วันนี้ไม่มีกะในตาราง</p>
        ) : (
          me.todayShifts.map((s) => (
            <div key={s.id} className="row-line">
              <strong>{shiftName(s.shiftTypeId)}</strong>
              <span className="mono">
                {s.start}–{s.end}
              </span>
              <span className="muted">{storeName(s.storeId)}</span>
            </div>
          ))
        )}
      </Card>

      <div className={`geo geo-${geo.kind === 'ok' ? (inside ? 'in' : 'out') : geo.kind}`}>
        <PinIcon />
        <span className="geo-text">
          {geo.kind === 'idle' && 'ยังไม่ได้ตรวจตำแหน่ง'}
          {geo.kind === 'locating' && 'กำลังหาตำแหน่ง…'}
          {geo.kind === 'error' && geo.message}
          {geo.kind === 'ok' &&
            (near
              ? inside
                ? `อยู่ในพื้นที่ · ห่าง ${fmtDistance(near.distanceM)} จาก ${near.store.name}`
                : `นอกพื้นที่ · ห่าง ${fmtDistance(near.distanceM)} จาก ${near.store.name}`
              : 'ยังไม่มีข้อมูลสาขา')}
          {geo.kind === 'ok' && <span className="geo-acc"> (±{Math.round(geo.pos.accuracy)} ม.)</span>}
        </span>
        <button className="btn btn-icon btn-ghost" onClick={() => void locate()} disabled={busy} aria-label="ตรวจตำแหน่งใหม่">
          <RefreshIcon />
        </button>
      </div>

      <div className="punch-wrap">
        {open && !onBreak && (
          <div className="timer" aria-live="off">
            <div className="timer-label">ทำงานมาแล้ว</div>
            <div className="timer-value">{fmtDuration(workMs)}</div>
            <div className="timer-sub">
              เข้างาน {hhmm(open.ts)} น. · {storeName(open.storeId)}
            </div>
            {shiftNote && <div className="timer-sub">{shiftNote}</div>}
            {breakMs > 0 && (
              <div className="timer-sub">
                พักไปแล้ว {fmtMin(Math.floor(breakMs / 60_000))}
                {breakAllowed > 0 && ` จาก ${breakAllowed} นาที`}
              </div>
            )}
          </div>
        )}
        {open && onBreak && (
          <div className={`timer timer-break ${breakAllowed && breakLeftMin < 0 ? 'timer-over' : ''}`} aria-live="off">
            <div className="timer-label">กำลังพัก</div>
            <div className="timer-value">{fmtDuration(serverNow - onBreak.ms)}</div>
            <div className="timer-sub">
              {breakAllowed > 0
                ? breakLeftMin >= 0
                  ? `พักได้ ${breakAllowed} นาที · เหลือ ${fmtMin(breakLeftMin)}`
                  : `เกินเวลาพัก ${fmtMin(-breakLeftMin)}`
                : `เริ่มพัก ${hhmm(onBreak.ts)} น.`}
            </div>
            <div className="timer-sub">ทำงานแล้ว {fmtDuration(workMs)} (หยุดนับระหว่างพัก)</div>
          </div>
        )}

        {!open && (
          <button className="punch punch-in" onClick={() => doPunch('IN')} disabled={busy || geo.kind === 'locating'}>
            <span className="punch-label">{busy ? 'กำลังบันทึก…' : 'เข้างาน'}</span>
            <span className="punch-sub">Clock in</span>
          </button>
        )}
        {open && !onBreak && (
          <>
            <button className="btn btn-ghost btn-break" onClick={() => doPunch('BREAK_START')} disabled={busy}>
              ☕ เริ่มพัก
            </button>
            <button className="punch punch-out" onClick={() => doPunch('OUT')} disabled={busy || geo.kind === 'locating'}>
              <span className="punch-label">{busy ? 'กำลังบันทึก…' : 'ออกงาน'}</span>
              <span className="punch-sub">Clock out</span>
            </button>
          </>
        )}
        {open && onBreak && (
          <>
            <button className="punch punch-back" onClick={() => doPunch('BREAK_END')} disabled={busy}>
              <span className="punch-label">{busy ? 'กำลังบันทึก…' : 'กลับเข้างาน'}</span>
              <span className="punch-sub">End break</span>
            </button>
            <button className="link" onClick={() => doPunch('OUT')} disabled={busy}>
              เลิกงานเลย (ไม่กลับเข้างาน)
            </button>
          </>
        )}
      </div>

      {result && (
        <div className={`alert ${result.ok ? 'alert-green' : 'alert-red'}`} role="status">
          {result.text}
        </div>
      )}

      <Card title="บันทึกวันนี้">
        {me.todayPunches.length === 0 ? (
          <p className="muted">ยังไม่มีการลงเวลา</p>
        ) : (
          <ul className="list">
            {me.todayPunches.map((p) => (
              <li key={p.id} className="row-line">
                <span className={`badge ${PUNCH_BADGE[p.type]}`}>{PUNCH_LABEL[p.type]}</span>
                <span className="mono">{hhmm(p.ts)}</span>
                <span className="muted">{storeName(p.storeId)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
