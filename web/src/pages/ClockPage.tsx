import type { MeResponse, PunchType } from '@shared/types';
import { useCallback, useEffect, useState } from 'react';
import { Card, PinIcon, RefreshIcon } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { fmtClock, fmtLongDate, hhmm, staffName } from '../lib/format';
import { type Position, fmtDistance, getPosition, nearestStore } from '../lib/geo';

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
  const nextType: PunchType = me.openPunch ? 'OUT' : 'IN';
  const near = geo.kind === 'ok' ? nearestStore(me.stores, geo.pos) : null;
  const inside = !!near && near.distanceM <= near.store.radiusM;

  async function doPunch() {
    setBusy(true);
    setResult(null);
    try {
      const pos = await locate(); // always use a fresh position
      if (!pos) throw new Error('ไม่พบตำแหน่ง กรุณาลองใหม่');
      const r = await api.punch({ type: nextType, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy });
      navigator.vibrate?.(60);
      setResult({ ok: true, text: r.message });
      setMe({
        ...me,
        openPunch: r.punch.type === 'IN' ? r.punch : null,
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
        <button
          className={`punch punch-${nextType === 'IN' ? 'in' : 'out'}`}
          onClick={doPunch}
          disabled={busy || geo.kind === 'locating'}
        >
          <span className="punch-label">{busy ? 'กำลังบันทึก…' : nextType === 'IN' ? 'เข้างาน' : 'ออกงาน'}</span>
          <span className="punch-sub">{nextType === 'IN' ? 'Clock in' : 'Clock out'}</span>
        </button>
        {me.openPunch && (
          <p className="muted center">
            เข้างานเมื่อ {hhmm(me.openPunch.ts)} น. · {storeName(me.openPunch.storeId)}
          </p>
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
                <span className={`badge ${p.type === 'IN' ? 'badge-green' : 'badge-brown'}`}>
                  {p.type === 'IN' ? 'เข้า' : 'ออก'}
                </span>
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
