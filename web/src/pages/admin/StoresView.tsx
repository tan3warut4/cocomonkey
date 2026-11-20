import type { Store } from '@shared/types';
import { useEffect, useState } from 'react';
import { Card, ErrorBox, Spinner } from '../../components/ui';
import { api, errMsg } from '../../lib/api';
import { getPosition } from '../../lib/geo';

export default function StoresView() {
  const [stores, setStores] = useState<Store[] | null>(null);
  const [radius, setRadius] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busyId, setBusyId] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .staff()
      .then((r) => {
        if (!alive) return;
        setStores(r.stores);
        setRadius(Object.fromEntries(r.stores.map((s) => [s.id, String(s.radiusM)])));
      })
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [reload]);

  async function save(s: Store, patch: Parameters<typeof api.updateStore>[1], done: string) {
    setBusyId(s.id);
    setError('');
    setMsg('');
    try {
      const r = await api.updateStore(s.id, patch);
      setStores((list) => list?.map((x) => (x.id === s.id ? r.store : x)) ?? null);
      setMsg(done);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusyId('');
    }
  }

  async function useHere(s: Store) {
    setBusyId(s.id);
    setError('');
    try {
      const pos = await getPosition();
      setBusyId('');
      if (pos.accuracy > 50 && !window.confirm(`GPS คลาดเคลื่อน ±${Math.round(pos.accuracy)} ม. ยังต้องการใช้ตำแหน่งนี้หรือไม่?`)) return;
      if (!window.confirm(`ตั้งตำแหน่งของ ${s.name} เป็นจุดที่คุณยืนอยู่ตอนนี้?`)) return;
      await save(s, { lat: pos.lat, lng: pos.lng }, `อัปเดตตำแหน่ง ${s.name} แล้ว`);
    } catch (e) {
      setError(errMsg(e));
      setBusyId('');
    }
  }

  if (!stores) return error ? <ErrorBox message={error} onRetry={() => setReload((x) => x + 1)} /> : <Spinner />;

  return (
    <div className="stack">
      <p className="muted small">
        ยืนอยู่ในร้านแล้วกด “ใช้ตำแหน่งปัจจุบัน” เพื่อแทนพิกัดทดสอบ · พนักงานต้องอยู่ภายในรัศมีจึงลงเวลาได้
      </p>
      {error && <ErrorBox message={error} />}
      {msg && <div className="alert alert-green">{msg}</div>}
      {stores.map((s) => (
        <Card key={s.id} title={s.name}>
          <div className="kv">
            <span className="muted">พิกัด</span>
            <a className="mono" href={`https://www.google.com/maps?q=${s.lat},${s.lng}`} target="_blank" rel="noreferrer">
              {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
            </a>
          </div>
          <div className="kv">
            <span className="muted">รัศมี (ม.)</span>
            <span className="inline-form">
              <input
                type="number"
                min={30}
                max={2000}
                step={10}
                value={radius[s.id] ?? ''}
                onChange={(e) => setRadius({ ...radius, [s.id]: e.target.value })}
              />
              <button
                className="btn btn-ghost btn-small"
                disabled={busyId === s.id || Number(radius[s.id]) === s.radiusM}
                onClick={() => save(s, { radiusM: Number(radius[s.id]) }, `บันทึกรัศมี ${s.name} แล้ว`)}
              >
                บันทึก
              </button>
            </span>
          </div>
          <button className="btn btn-primary btn-block" disabled={busyId === s.id} onClick={() => useHere(s)}>
            {busyId === s.id ? 'กำลังทำงาน…' : 'ใช้ตำแหน่งปัจจุบันเป็นที่ตั้งร้าน'}
          </button>
        </Card>
      ))}
      <p className="muted small">เพิ่มสาขา หรือแก้เวลากะ/การตั้งค่าสาย-OT ได้ใน Google Sheet (แท็บ Stores, ShiftTypes, Settings)</p>
    </div>
  );
}
