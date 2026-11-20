import type { MeResponse } from '@shared/types';
import { type FormEvent, useState } from 'react';
import { Card, ErrorBox } from '../components/ui';
import { api, errMsg } from '../lib/api';

const NEW = '__new';

export default function RegisterPage({ me, onDone }: { me: MeResponse; onDone: (m: MeResponse) => void }) {
  const hasList = me.claimable.length > 0;
  const [claimId, setClaimId] = useState(hasList ? '' : NEW);
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState(hasList ? '' : me.lineName);
  const [phone, setPhone] = useState('');
  const [storeId, setStoreId] = useState(me.stores[0]?.id ?? '');
  const [ownerCode, setOwnerCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function pick(id: string) {
    setClaimId(id);
    const row = me.claimable.find((c) => c.id === id);
    setNickname(row ? row.nickname : me.lineName);
    setName(row?.name ?? '');
    if (row?.storeId && me.stores.some((s) => s.id === row.storeId)) setStoreId(row.storeId);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onDone(
        await api.register({
          claimId: claimId && claimId !== NEW ? claimId : undefined,
          name,
          nickname,
          phone,
          storeId,
          ownerCode: ownerCode || undefined,
        }),
      );
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const chosen = claimId !== '';
  return (
    <div className="stack">
      <h1 className="page-title">ลงทะเบียนพนักงาน</h1>
      <p className="muted">ทำครั้งแรกครั้งเดียว แล้วรอเจ้าของร้านอนุมัติ</p>

      {hasList && (
        <Card title="คุณคือใคร?">
          <div className="name-picks">
            {me.claimable.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip chip-lg ${claimId === c.id ? 'active' : ''}`}
                onClick={() => pick(c.id)}
              >
                {c.nickname || c.name}
              </button>
            ))}
            <button type="button" className={`chip chip-lg ${claimId === NEW ? 'active' : ''}`} onClick={() => pick(NEW)}>
              ไม่มีชื่อในรายการ
            </button>
          </div>
        </Card>
      )}

      {chosen && (
        <Card>
          <form className="form" onSubmit={submit}>
            <label>
              ชื่อ-นามสกุล *
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" />
            </label>
            <label>
              ชื่อเล่น
              <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={40} />
            </label>
            <label>
              เบอร์โทร
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={20} autoComplete="tel" />
            </label>
            <label>
              สาขาที่ทำงานประจำ *
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)} required>
                {me.stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {claimId === NEW && (
              <details className="owner-code">
                <summary>สำหรับเจ้าของร้าน</summary>
                <label>
                  รหัสเจ้าของร้าน
                  <input value={ownerCode} onChange={(e) => setOwnerCode(e.target.value)} type="password" autoComplete="off" />
                </label>
              </details>
            )}
            {error && <ErrorBox message={error} />}
            <button className="btn btn-primary btn-block" disabled={busy || !name || !storeId}>
              {busy ? 'กำลังบันทึก…' : 'ลงทะเบียน'}
            </button>
          </form>
        </Card>
      )}
    </div>
  );
}
