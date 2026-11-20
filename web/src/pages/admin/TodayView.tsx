import type { DayRecord, TodayResponse } from '@shared/types';
import { useEffect, useState } from 'react';
import { Card, ErrorBox, Flags, Spinner, Stat } from '../../components/ui';
import { api, errMsg } from '../../lib/api';
import { fmtDate, hhmm, staffName } from '../../lib/format';
import { RefreshIcon } from '../../components/ui';

export default function TodayView() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setError('');
    api
      .today()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [reload]);

  if (error) return <ErrorBox message={error} onRetry={() => setReload((x) => x + 1)} />;
  if (!data) return <Spinner />;

  const working = data.days.filter((d) => d.flags.includes('in_progress')).length;
  const late = data.days.filter((d) => d.lateMin > 0).length;
  const notIn = data.days.filter((d) => d.flags.includes('not_in_yet') || d.flags.includes('absent')).length;
  const staffById = new Map(data.staff.map((s) => [s.id, s]));
  const storeOf = (d: DayRecord) => d.storeId || d.inStoreId || '';

  return (
    <div className="stack">
      <div className="row-between">
        <h1 className="page-title">{fmtDate(data.date, { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
        <button className="btn btn-icon btn-ghost" onClick={() => setReload((x) => x + 1)} aria-label="รีเฟรช">
          <RefreshIcon />
        </button>
      </div>
      <div className="stats">
        <Stat label="กำลังทำงาน" value={working} sub="คน" tone="green" />
        <Stat label="สาย" value={late} sub="คน" tone={late ? 'amber' : ''} />
        <Stat label="ยังไม่เข้า/ขาด" value={notIn} sub="คน" tone={notIn ? 'red' : ''} />
      </div>
      {data.stores
        .filter((s) => s.active)
        .map((store) => {
          const rows = data.days.filter((d) => storeOf(d) === store.id);
          return (
            <Card key={store.id} title={store.name}>
              {rows.length === 0 ? (
                <p className="muted">วันนี้ไม่มีกะ</p>
              ) : (
                <ul className="list">
                  {rows.map((d, i) => (
                    <li key={`${d.staffId}-${i}`} className="today-row">
                      <div>
                        <strong>{staffName(staffById.get(d.staffId))}</strong>
                        <div className="muted small">
                          {d.shiftId ? `${d.shiftName} ${d.schedStart}–${d.schedEnd}` : 'ไม่มีกะ'}
                        </div>
                      </div>
                      <div className="today-right">
                        <span className="mono">
                          {hhmm(d.inTs)} → {hhmm(d.outTs)}
                        </span>
                        <Flags flags={d.lateMin > 0 ? d.flags : d.flags.filter((f) => f !== 'late')} />
                        {d.lateMin > 0 && <span className="small t-amber">สาย {d.lateMin} นาที</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
    </div>
  );
}
