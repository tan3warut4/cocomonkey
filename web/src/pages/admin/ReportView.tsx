import type { ReportResponse } from '@shared/types';
import { useEffect, useState } from 'react';
import { Card, ErrorBox, Flags, Pager, Spinner } from '../../components/ui';
import { api, errMsg } from '../../lib/api';
import { downloadCsv } from '../../lib/csv';
import { FLAG_LABEL, addMonths, fmtDate, fmtHM, fmtMonth, hhmm, hours2, staffName, thisMonth } from '../../lib/format';
import { isInLine, openInBrowser } from '../../lib/liff';

export default function ReportView() {
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<ReportResponse | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    api
      .report(month)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [month, reload]);

  const staffById = new Map(data?.staff.map((s) => [s.id, s]) ?? []);
  const storeById = new Map(data?.stores.map((s) => [s.id, s]) ?? []);

  function csvSummary() {
    if (!data) return;
    downloadCsv(
      `summary-${data.month}.csv`,
      ['รหัส', 'ชื่อ', 'กะทั้งหมด', 'มาทำงาน', 'ขาด', 'สาย (ครั้ง)', 'สาย (นาที)', 'ออกก่อน (นาที)', 'ชั่วโมงปกติ', 'OT (ชั่วโมง)', 'นอกตาราง (ชั่วโมง)', 'ลืมลงเวลา (ครั้ง)', 'พักเกิน (ครั้ง)', 'พักเกิน (นาที)'],
      data.summaries.map((s) => [
        s.staffId,
        s.name,
        s.scheduled,
        s.attended,
        s.absent,
        s.lateCount,
        s.lateMin,
        s.earlyLeaveMin,
        hours2(s.regularMin),
        hours2(s.otMin),
        hours2(s.unscheduledMin),
        s.missingPunch,
        s.overBreakCount,
        s.overBreakMin,
      ]),
    );
  }

  function csvDaily() {
    if (!data) return;
    downloadCsv(
      `daily-${data.month}.csv`,
      ['วันที่', 'รหัส', 'ชื่อ', 'สาขา', 'กะ', 'เริ่มกะ', 'เลิกกะ', 'เข้า', 'ออก', 'สาย (นาที)', 'ออกก่อน (นาที)', 'พักตามกะ (นาที)', 'พักจริง (นาที)', 'พักเกิน (นาที)', 'ปกติ (นาที)', 'OT (นาที)', 'นอกตาราง (นาที)', 'หมายเหตุ'],
      data.days.map((d) => [
        d.date,
        d.staffId,
        staffById.get(d.staffId)?.name ?? '',
        storeById.get(d.storeId)?.name ?? d.storeId,
        d.shiftName ?? '',
        d.schedStart ?? '',
        d.schedEnd ?? '',
        d.inTs ? hhmm(d.inTs) : '',
        d.outTs ? `${hhmm(d.outTs)}${d.outTs.slice(0, 10) !== d.date ? ' (+1)' : ''}` : '',
        d.lateMin,
        d.earlyLeaveMin,
        d.breakMin ?? '',
        d.breakTakenMin ?? '',
        d.overBreakMin,
        d.regularMin,
        d.otMin,
        d.unscheduledMin,
        d.flags.map((f) => FLAG_LABEL[f]).join(' '),
      ]),
    );
  }

  return (
    <div className="stack">
      <Pager
        label={fmtMonth(month)}
        onPrev={() => setMonth(addMonths(month, -1))}
        onNext={() => setMonth(addMonths(month, 1))}
        onToday={() => setMonth(thisMonth())}
      />
      {error && <ErrorBox message={error} onRetry={() => setReload((x) => x + 1)} />}
      {!data && !error && <Spinner />}
      {data && (
        <>
          <p className="muted small">
            สายเมื่อเกิน {data.settings.lateGraceMin} นาที · OT นับเมื่อเกิน {data.settings.otMinMin} นาที ปัดลงทีละ{' '}
            {data.settings.otRoundMin} นาที · ชั่วโมงแสดงเป็น ชม.:นาที
          </p>
          <div className="table-scroll">
            <table className="report">
              <thead>
                <tr>
                  <th className="sticky-col">พนักงาน</th>
                  <th>มา/กะ</th>
                  <th>สาย</th>
                  <th>ออกก่อน</th>
                  <th>ปกติ</th>
                  <th>OT</th>
                  <th>ขาด</th>
                  <th>ลืมลงเวลา</th>
                  <th>นอกตาราง</th>
                  <th>พักเกิน</th>
                </tr>
              </thead>
              <tbody>
                {data.summaries.map((s) => (
                  <tr key={s.staffId} className={open === s.staffId ? 'is-open' : ''} onClick={() => setOpen(open === s.staffId ? null : s.staffId)}>
                    <th className="sticky-col">{staffName(staffById.get(s.staffId))}</th>
                    <td>
                      {s.attended}/{s.scheduled}
                    </td>
                    <td className={s.lateCount ? 't-amber' : ''}>{s.lateCount ? `${s.lateCount} (${s.lateMin}น.)` : '–'}</td>
                    <td>{s.earlyLeaveMin ? `${s.earlyLeaveMin}น.` : '–'}</td>
                    <td className="mono">{fmtHM(s.regularMin)}</td>
                    <td className={`mono ${s.otMin ? 't-blue' : ''}`}>{s.otMin ? fmtHM(s.otMin) : '–'}</td>
                    <td className={s.absent ? 't-red' : ''}>{s.absent || '–'}</td>
                    <td className={s.missingPunch ? 't-red' : ''}>{s.missingPunch || '–'}</td>
                    <td className="mono">{s.unscheduledMin ? fmtHM(s.unscheduledMin) : '–'}</td>
                    <td className={s.overBreakCount ? 't-amber' : ''}>{s.overBreakCount ? `${s.overBreakCount} (${s.overBreakMin}น.)` : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">แตะชื่อเพื่อดูรายวัน</p>

          {open && (
            <Card title={staffName(staffById.get(open))} action={<button className="btn btn-small btn-ghost" onClick={() => setOpen(null)}>ปิด</button>}>
              <ul className="list">
                {data.days
                  .filter((d) => d.staffId === open)
                  .map((d, i) => (
                    <li key={`${d.date}-${i}`} className="hist-row">
                      <div className="hist-date">{fmtDate(d.date)}</div>
                      <div className="hist-body">
                        <div className="muted small">
                          {d.shiftId ? `${d.shiftName} ${d.schedStart}–${d.schedEnd}` : 'ไม่มีกะ'}
                          {d.storeId && ` · ${storeById.get(d.storeId)?.name ?? d.storeId}`}
                        </div>
                        <div className="mono">
                          {hhmm(d.inTs)} → {hhmm(d.outTs)}
                          {d.regularMin > 0 && <span className="muted"> · {fmtHM(d.regularMin)}</span>}
                          {d.lateMin > 0 && <span className="t-amber"> · สาย {d.lateMin}น.</span>}
                          {d.otMin > 0 && <span className="t-blue"> · OT {fmtHM(d.otMin)}</span>}
                        </div>
                        {d.breakTakenMin !== undefined && (
                          <div className={`small ${d.overBreakMin ? 't-amber' : 'muted'}`}>
                            พัก {d.breakTakenMin} นาที{d.breakMin ? ` (กะ ${d.breakMin})` : ''}
                            {d.overBreakMin > 0 && ` · เกิน ${d.overBreakMin} นาที`}
                          </div>
                        )}
                        <Flags flags={d.flags.filter((f) => f !== 'late' && f !== 'ot')} />
                      </div>
                    </li>
                  ))}
              </ul>
            </Card>
          )}

          <Card title="ส่งออกสำหรับทำเงินเดือน">
            <div className="actions">
              <button className="btn btn-primary" onClick={csvSummary}>
                CSV สรุปรายคน
              </button>
              <button className="btn btn-ghost" onClick={csvDaily}>
                CSV รายวัน
              </button>
            </div>
            {isInLine() && (
              <p className="muted small">
                ถ้าดาวน์โหลดในแอป LINE ไม่ได้{' '}
                <button className="link" onClick={openInBrowser}>
                  เปิดในเบราว์เซอร์
                </button>{' '}
                หรือดูข้อมูลดิบได้ใน Google Sheet
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
