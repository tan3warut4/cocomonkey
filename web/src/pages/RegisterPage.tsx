import type { MeResponse } from '@shared/types';
import { type FormEvent, useState } from 'react';
import { Card, ErrorBox } from '../components/ui';
import { api, errMsg } from '../lib/api';

export default function RegisterPage({ me, onDone }: { me: MeResponse; onDone: (m: MeResponse) => void }) {
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState(me.lineName);
  const [phone, setPhone] = useState('');
  const [storeId, setStoreId] = useState(me.stores[0]?.id ?? '');
  const [ownerCode, setOwnerCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onDone(await api.register({ name, nickname, phone, storeId, ownerCode: ownerCode || undefined }));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1 className="page-title">ลงทะเบียนพนักงาน</h1>
      <p className="muted">กรอกข้อมูลครั้งแรกครั้งเดียว แล้วรอเจ้าของร้านอนุมัติ</p>
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
            สาขาที่ทำงาน *
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} required>
              {me.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <details className="owner-code">
            <summary>สำหรับเจ้าของร้าน</summary>
            <label>
              รหัสเจ้าของร้าน
              <input value={ownerCode} onChange={(e) => setOwnerCode(e.target.value)} type="password" autoComplete="off" />
            </label>
          </details>
          {error && <ErrorBox message={error} />}
          <button className="btn btn-primary btn-block" disabled={busy || !name || !storeId}>
            {busy ? 'กำลังบันทึก…' : 'ลงทะเบียน'}
          </button>
        </form>
      </Card>
    </div>
  );
}
