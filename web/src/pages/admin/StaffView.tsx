import type { Staff, StaffUpdateRequest, Store } from '@shared/types';
import { useEffect, useState } from 'react';
import { Card, ErrorBox, Spinner } from '../../components/ui';
import { api, errMsg } from '../../lib/api';

export default function StaffView({ meId }: { meId: string }) {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setError('');
    api
      .staff()
      .then((r) => {
        if (!alive) return;
        setStaff(r.staff);
        setStores(r.stores);
      })
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [reload]);

  async function update(s: Staff, patch: StaffUpdateRequest, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyId(s.id);
    setError('');
    try {
      const r = await api.updateStaff(s.id, patch);
      setStaff((list) => list?.map((x) => (x.id === s.id ? r.staff : x)) ?? null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusyId('');
    }
  }

  if (!staff) return error ? <ErrorBox message={error} onRetry={() => setReload((x) => x + 1)} /> : <Spinner />;

  const pending = staff.filter((s) => s.status === 'pending');
  const active = staff.filter((s) => s.status === 'active');
  const inactive = staff.filter((s) => s.status === 'inactive');
  const storeSelect = (s: Staff) => (
    <select value={s.storeId} disabled={busyId === s.id} onChange={(e) => update(s, { storeId: e.target.value })}>
      {stores.map((st) => (
        <option key={st.id} value={st.id}>
          {st.name}
        </option>
      ))}
    </select>
  );
  const who = (s: Staff) => (
    <div>
      <strong>{s.nickname ? `${s.nickname} · ${s.name}` : s.name}</strong>
      <div className="muted small">
        LINE: {s.lineName || '–'}
        {s.phone && (
          <>
            {' · '}
            <a href={`tel:${s.phone}`}>{s.phone}</a>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="stack">
      {error && <ErrorBox message={error} />}

      <Card title={`รออนุมัติ (${pending.length})`}>
        {pending.length === 0 ? (
          <p className="muted">ไม่มีคำขอใหม่ · ส่งลิงก์แอปให้พนักงานลงทะเบียนผ่าน LINE</p>
        ) : (
          <ul className="list">
            {pending.map((s) => (
              <li key={s.id} className="staff-row">
                {who(s)}
                <div className="staff-controls">
                  {storeSelect(s)}
                  <button className="btn btn-primary btn-small" disabled={busyId === s.id} onClick={() => update(s, { status: 'active' })}>
                    อนุมัติ
                  </button>
                  <button
                    className="btn btn-ghost btn-small"
                    disabled={busyId === s.id}
                    onClick={() => update(s, { status: 'inactive' }, `ปฏิเสธ ${s.name}?`)}
                  >
                    ปฏิเสธ
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`พนักงาน (${active.length})`}>
        <ul className="list">
          {active.map((s) => (
            <li key={s.id} className="staff-row">
              {who(s)}
              <div className="staff-controls">
                {storeSelect(s)}
                <select
                  value={s.role}
                  disabled={busyId === s.id || s.id === meId}
                  onChange={(e) =>
                    update(s, { role: e.target.value as Staff['role'] }, e.target.value === 'owner' ? `ให้ ${s.name} เป็นเจ้าของร้าน (เห็นรายงานและจัดการได้ทั้งหมด)?` : undefined)
                  }
                >
                  <option value="staff">พนักงาน</option>
                  <option value="owner">เจ้าของร้าน</option>
                </select>
                {s.id !== meId && (
                  <button
                    className="btn btn-ghost btn-small"
                    disabled={busyId === s.id}
                    onClick={() => update(s, { status: 'inactive' }, `ปิดการใช้งาน ${s.name}? (ประวัติการลงเวลายังอยู่)`)}
                  >
                    ปิดใช้งาน
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {inactive.length > 0 && (
        <Card title={`ปิดใช้งาน (${inactive.length})`}>
          <ul className="list">
            {inactive.map((s) => (
              <li key={s.id} className="staff-row is-muted">
                {who(s)}
                <button className="btn btn-ghost btn-small" disabled={busyId === s.id} onClick={() => update(s, { status: 'active' })}>
                  เปิดใช้งานอีกครั้ง
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
