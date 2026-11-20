import type { MeResponse } from '@shared/types';
import { Card } from '../components/ui';
import { addDays, fmtDate, todayStr } from '../lib/format';

export default function ShiftsPage({ me }: { me: MeResponse }) {
  const today = todayStr();
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const storeName = (id: string) => me.stores.find((s) => s.id === id)?.name ?? id;
  const typeName = (id: string) => me.shiftTypes.find((t) => t.id === id)?.name ?? 'กะ';
  const workDays = days.filter((d) => me.upcomingShifts.some((s) => s.date === d)).length;

  return (
    <div className="stack">
      <h1 className="page-title">กะของฉัน</h1>
      <p className="muted">14 วันข้างหน้า · ทำงาน {workDays} วัน</p>
      <Card>
        <ul className="list">
          {days.map((d) => {
            const shifts = me.upcomingShifts.filter((s) => s.date === d);
            return (
              <li key={d} className={`day-row ${d === today ? 'is-today' : ''} ${shifts.length ? '' : 'is-off'}`}>
                <div className="day-date">
                  <span>{fmtDate(d, { weekday: 'short' })}</span>
                  <strong>{fmtDate(d, { day: 'numeric', month: 'short' })}</strong>
                </div>
                <div className="day-body">
                  {shifts.length === 0 ? (
                    <span className="muted">วันหยุด</span>
                  ) : (
                    shifts.map((s) => (
                      <div key={s.id}>
                        <strong>{typeName(s.shiftTypeId)}</strong>{' '}
                        <span className="mono">
                          {s.start}–{s.end}
                        </span>
                        <div className="muted small">{storeName(s.storeId)}</div>
                      </div>
                    ))
                  )}
                </div>
                {d === today && <span className="badge badge-green">วันนี้</span>}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
