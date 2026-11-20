import type { MyAttendanceResponse } from '@shared/types';
import { useEffect, useState } from 'react';
import { Card, ErrorBox, Flags, Pager, Spinner, Stat } from '../components/ui';
import { api, errMsg } from '../lib/api';
import { addMonths, fmtDate, fmtMin, fmtMonth, hhmm, thisMonth } from '../lib/format';

export default function HistoryPage() {
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<MyAttendanceResponse | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    api
      .myAttendance(month)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [month, reload]);

  const s = data?.summary;
  return (
    <div className="stack">
      <h1 className="page-title">ประวัติการทำงาน</h1>
      <Pager
        label={fmtMonth(month)}
        onPrev={() => setMonth(addMonths(month, -1))}
        onNext={() => setMonth(addMonths(month, 1))}
        onToday={() => setMonth(thisMonth())}
      />
      {error && <ErrorBox message={error} onRetry={() => setReload((x) => x + 1)} />}
      {!data && !error && <Spinner />}
      {s && data && (
        <>
          <div className="stats">
            <Stat label="มาทำงาน" value={`${s.attended}/${s.scheduled}`} sub="วัน (ตามกะ)" />
            <Stat label="สาย" value={s.lateCount} sub={s.lateMin ? fmtMin(s.lateMin) : 'ครั้ง'} tone={s.lateCount ? 'amber' : ''} />
            <Stat label="OT" value={fmtMin(s.otMin)} tone={s.otMin ? 'blue' : ''} />
            <Stat label="ขาด / ลืมลงเวลา" value={`${s.absent} / ${s.missingPunch}`} tone={s.absent + s.missingPunch ? 'red' : ''} />
          </div>
          <Card title="รายวัน">
            {data.days.length === 0 ? (
              <p className="muted">ไม่มีข้อมูลในเดือนนี้</p>
            ) : (
              <ul className="list">
                {[...data.days].reverse().map((d, i) => (
                  <li key={`${d.date}-${i}`} className="hist-row">
                    <div className="hist-date">{fmtDate(d.date)}</div>
                    <div className="hist-body">
                      <div>
                        {d.shiftId ? (
                          <span className="muted small">
                            {d.shiftName} {d.schedStart}–{d.schedEnd}
                          </span>
                        ) : (
                          <span className="muted small">ไม่มีกะ</span>
                        )}
                      </div>
                      <div className="mono">
                        {hhmm(d.inTs)} → {hhmm(d.outTs)}
                        {d.lateMin > 0 && <span className="t-amber"> · สาย {d.lateMin} นาที</span>}
                        {d.otMin > 0 && <span className="t-blue"> · OT {fmtMin(d.otMin)}</span>}
                      </div>
                      <Flags flags={d.flags.filter((f) => f !== 'late' && f !== 'ot')} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
