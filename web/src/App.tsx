import type { MeResponse } from '@shared/types';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ErrorBox, Spinner } from './components/ui';
import { CONFIG_ERROR, DEV_MODE } from './config';
import { ApiError, api, errMsg, login } from './lib/api';
import AdminPage from './pages/admin/AdminPage';
import ClockPage from './pages/ClockPage';
import HistoryPage from './pages/HistoryPage';
import RegisterPage from './pages/RegisterPage';
import ShiftsPage from './pages/ShiftsPage';

type Tab = 'clock' | 'shifts' | 'history' | 'admin';

export default function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('clock');
  const started = useRef(false);

  const start = useCallback(async (force = false) => {
    setError('');
    try {
      setMe(await login(force));
    } catch (e) {
      setError(errMsg(e));
      if (e instanceof ApiError && e.status === 401) started.current = false;
    }
  }, []);

  useEffect(() => {
    if (started.current || CONFIG_ERROR) return;
    started.current = true;
    void start();
  }, [start]);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  if (CONFIG_ERROR) return <Shell><ErrorBox message={CONFIG_ERROR} /></Shell>;
  if (error && !me) return <Shell><ErrorBox message={error} onRetry={() => start(true)} /></Shell>;
  if (!me) return <Shell><Spinner label="กำลังเข้าสู่ระบบ…" /></Shell>;

  if (!me.me) return <Shell><RegisterPage me={me} onDone={setMe} /></Shell>;

  if (me.me.status === 'pending') {
    return (
      <Shell>
        <div className="center-msg">
          <div className="big-emoji" aria-hidden>⏳</div>
          <h2>รอเจ้าของร้านอนุมัติ</h2>
          <p className="muted">ลงทะเบียนเรียบร้อยแล้ว เมื่อได้รับอนุมัติจะเริ่มลงเวลาได้</p>
          <button className="btn btn-primary" onClick={refresh}>ตรวจสอบอีกครั้ง</button>
        </div>
      </Shell>
    );
  }
  if (me.me.status !== 'active') {
    return (
      <Shell>
        <div className="center-msg">
          <h2>บัญชีถูกปิดการใช้งาน</h2>
          <p className="muted">กรุณาติดต่อเจ้าของร้าน</p>
        </div>
      </Shell>
    );
  }

  const isOwner = me.me.role === 'owner';
  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'clock', label: 'ลงเวลา', icon: '◷' },
    { id: 'shifts', label: 'กะของฉัน', icon: '▦' },
    { id: 'history', label: 'ประวัติ', icon: '≡' },
    ...(isOwner ? [{ id: 'admin' as Tab, label: 'จัดการร้าน', icon: '⚙' }] : []),
  ];

  return (
    <Shell wide={tab === 'admin'}>
      {error && <ErrorBox message={error} onRetry={() => { setError(''); void refresh(); }} />}
      {tab === 'clock' && <ClockPage me={me} setMe={setMe} />}
      {tab === 'shifts' && <ShiftsPage me={me} />}
      {tab === 'history' && <HistoryPage />}
      {tab === 'admin' && isOwner && <AdminPage me={me} />}
      <nav className="bottom-nav">
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            <span className="nav-icon" aria-hidden>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </Shell>
  );
}

function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand-mark" aria-hidden />
        <span className="brand">Jingjo Coconut</span>
        {DEV_MODE && <span className="badge badge-amber">DEV</span>}
      </header>
      <main className={wide ? 'content content-wide' : 'content'}>{children}</main>
    </div>
  );
}
