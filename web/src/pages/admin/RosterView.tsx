import type { RosterResponse, Store } from '@shared/types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorBox, Pager, Spinner } from '../../components/ui';
import { api, errMsg } from '../../lib/api';
import { addDays, fmtDate, todayStr, weekStart } from '../../lib/format';

const key = (date: string, staffId: string) => `${date}|${staffId}`;
const CUSTOM = '__custom';

/** "Cocomonkey สาขาจุฬา" -> "สาขาจุฬา": drop words every store name shares, but never leave just a number. */
function shortNames(stores: Store[]): Map<string, string> {
  const words = stores.map((s) => s.name.split(/\s+/));
  let n = 0;
  while (words.length > 1 && words.every((w) => w.length > n + 1 && w[n] === words[0][n])) n++;
  return new Map(
    stores.map((s, i) => {
      let k = n;
      while (k > 0 && /^\d+$/.test(words[i].slice(k).join(' '))) k--;
      return [s.id, words[i].slice(k).join(' ') || s.name];
    }),
  );
}

export default function RosterView() {
  const [from, setFrom] = useState(() => weekStart(todayStr()));
  const [data, setData] = useState<RosterResponse | null>(null);
  const [grid, setGrid] = useState<Record<string, string>>({});
  const [orig, setOrig] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [storeFilter, setStoreFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [reload, setReload] = useState(0);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(from, i)), [from]);
  const today = todayStr();

  const apply = useCallback((r: RosterResponse) => {
    const valid = new Set(r.shiftTypes.map((t) => t.id));
    const g: Record<string, string> = {};
    const c: Record<string, string> = {};
    for (const s of r.shifts) {
      const k = key(s.date, s.staffId);
      if (k in g) continue;
      if (valid.has(s.shiftTypeId)) g[k] = s.shiftTypeId;
      else {
        g[k] = CUSTOM;
        c[k] = `${s.start}–${s.end}`;
      }
    }
    setData(r);
    setGrid(g);
    setOrig(g);
    setCustom(c);
  }, []);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError('');
    setMsg('');
    api
      .roster(from)
      .then((r) => alive && apply(r))
      .catch((e) => alive && setError(errMsg(e)))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [from, apply, reload]);

  const dirty = Object.keys({ ...grid, ...orig }).filter((k) => (grid[k] ?? '') !== (orig[k] ?? ''));

  function go(weeks: number | null) {
    if (dirty.length && !window.confirm('มีการแก้ไขที่ยังไม่บันทึก ต้องการทิ้งการแก้ไขหรือไม่?')) return;
    setFrom(weeks === null ? weekStart(todayStr()) : addDays(from, weeks * 7));
  }

  if (error && !data) return <ErrorBox message={error} onRetry={() => setReload((x) => x + 1)} />;
  if (!data) return <Spinner />;

  const types = data.shiftTypes.filter((t) => t.active);
  const typeById = new Map(data.shiftTypes.map((t) => [t.id, t]));
  const toneOf = new Map(data.shiftTypes.map((t, i) => [t.id, i % 6]));
  const short = shortNames(data.stores);
  const staff = data.staff.filter((s) => storeFilter === 'all' || s.storeId === storeFilter);

  async function copyPrevWeek() {
    setBusy(true);
    setError('');
    try {
      const prev = await api.roster(addDays(from, -7));
      const valid = new Set(prev.shiftTypes.filter((t) => t.active).map((t) => t.id));
      const g = { ...grid };
      for (const s of staff) {
        days.forEach((d, i) => {
          const p = prev.shifts.find((x) => x.staffId === s.id && x.date === addDays(from, i - 7));
          g[key(d, s.id)] = p && valid.has(p.shiftTypeId) ? p.shiftTypeId : '';
        });
      }
      setGrid(g);
      setMsg('คัดลอกจากสัปดาห์ก่อนแล้ว — ตรวจสอบแล้วกดบันทึก');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const cells = dirty
        .filter((k) => grid[k] !== CUSTOM)
        .map((k) => {
          const [date, staffId] = k.split('|');
          return { date, staffId, shiftTypeId: grid[k] || null };
        });
      apply(await api.saveRoster({ from, to: addDays(from, 6), cells }));
      setMsg('บันทึกตารางกะแล้ว');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Pager
        label={`${fmtDate(days[0], { day: 'numeric', month: 'short' })} – ${fmtDate(days[6], { day: 'numeric', month: 'short', year: '2-digit' })}`}
        onPrev={() => go(-1)}
        onNext={() => go(1)}
        onToday={() => go(null)}
      />

      <div className="chips">
        {[{ id: 'all', name: 'ทุกสาขา' }, ...data.stores.filter((s) => s.active)].map((s) => (
          <button
            key={s.id}
            className={`chip ${storeFilter === s.id ? 'active' : ''}`}
            onClick={() => setStoreFilter(s.id)}
          >
            {s.id === 'all' ? s.name : short.get(s.id)}
          </button>
        ))}
      </div>

      <div className="table-scroll">
        <table className="roster">
          <thead>
            <tr>
              <th className="sticky-col">พนักงาน</th>
              {days.map((d) => (
                <th key={d} className={d === today ? 'is-today' : ''}>
                  <div>{fmtDate(d, { weekday: 'short' })}</div>
                  <div className="small">{fmtDate(d, { day: 'numeric' })}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <th className="sticky-col">
                  <div className="roster-name">{s.nickname || s.name}</div>
                  <div className="small muted">{short.get(s.storeId) ?? 'ยังไม่ระบุสาขา'}</div>
                </th>
                {days.map((d) => {
                  const k = key(d, s.id);
                  const v = grid[k] ?? '';
                  const t = typeById.get(v);
                  const isDirty = (grid[k] ?? '') !== (orig[k] ?? '');
                  return (
                    <td key={d}>
                      <div className={`cell ${t ? `cell-t${toneOf.get(t.id)}` : v === CUSTOM ? 'cell-custom' : 'cell-off'} ${isDirty ? 'cell-dirty' : ''}`}>
                        <div className="cell-label">
                          {t ? (
                            <>
                              <strong>{t.name}</strong>
                              <span>{t.start}</span>
                              {t.storeId !== s.storeId && <em>{short.get(t.storeId)}</em>}
                            </>
                          ) : v === CUSTOM ? (
                            <>
                              <strong>กำหนดเอง</strong>
                              <span>{custom[k]}</span>
                            </>
                          ) : (
                            <span className="muted">หยุด</span>
                          )}
                        </div>
                        <select
                          className="cell-select"
                          value={v}
                          aria-label={`${s.name} ${d}`}
                          onChange={(e) => setGrid({ ...grid, [k]: e.target.value })}
                        >
                          <option value="">หยุด</option>
                          {v === CUSTOM && <option value={CUSTOM}>กำหนดเอง {custom[k]}</option>}
                          {data.stores
                            .filter((st) => st.active)
                            .map((st) => (
                              <optgroup key={st.id} label={st.name}>
                                {types
                                  .filter((x) => x.storeId === st.id)
                                  .map((x) => (
                                    <option key={x.id} value={x.id}>
                                      {x.name} {x.start}–{x.end}
                                    </option>
                                  ))}
                              </optgroup>
                            ))}
                        </select>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th className="sticky-col small">รวม (คน)</th>
              {days.map((d) => (
                <td key={d} className="center small">
                  {staff.filter((s) => grid[key(d, s.id)]).length}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {staff.length === 0 && <p className="muted">ยังไม่มีพนักงานที่อนุมัติแล้วในสาขานี้</p>}

      {error && <ErrorBox message={error} />}
      {msg && <div className="alert alert-green">{msg}</div>}

      <div className="actions sticky-actions">
        <button className="btn btn-ghost" onClick={copyPrevWeek} disabled={busy}>
          คัดลอกสัปดาห์ก่อน
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy || dirty.length === 0}>
          {busy ? 'กำลังบันทึก…' : `บันทึก${dirty.length ? ` (${dirty.length})` : ''}`}
        </button>
      </div>
      <p className="muted small">
        แก้ชื่อ/เวลาของกะได้ในแท็บ ShiftTypes ของ Google Sheet · 1 คนมีได้ 1 กะต่อวัน
      </p>
    </div>
  );
}
