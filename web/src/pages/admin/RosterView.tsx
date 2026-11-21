import type { RosterCell, RosterResponse, ShiftType, Staff, Store } from '@shared/types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorBox, Pager, Spinner } from '../../components/ui';
import { api, errMsg } from '../../lib/api';
import { addDays, fmtDate, fmtMin, todayStr, weekStart } from '../../lib/format';

const key = (date: string, staffId: string) => `${date}|${staffId}`;

/** One roster cell: a shift template plus this day's (possibly adjusted) times. typeId '' = legacy custom row. */
interface CellVal {
  typeId: string;
  start: string;
  end: string;
  breakMin: number;
}
type Grid = Record<string, CellVal | null>;

const same = (a: CellVal | null | undefined, b: CellVal | null | undefined) =>
  (!a && !b) || (!!a && !!b && a.typeId === b.typeId && a.start === b.start && a.end === b.end && a.breakMin === b.breakMin);

const isAdjusted = (v: CellVal, t?: ShiftType) => !!t && (v.start !== t.start || v.end !== t.end || v.breakMin !== t.breakMin);

/** Working minutes of a shift: end - start (overnight wraps) - break. */
function workMinutes(start: string, end: string, breakMin: number): number {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let d = toMin(end) - toMin(start);
  if (d <= 0) d += 1440;
  return Math.max(0, d - breakMin);
}

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

function gridFrom(r: RosterResponse): Grid {
  const valid = new Set(r.shiftTypes.map((t) => t.id));
  const g: Grid = {};
  for (const s of r.shifts) {
    const k = key(s.date, s.staffId);
    if (k in g) continue;
    g[k] = { typeId: valid.has(s.shiftTypeId) ? s.shiftTypeId : '', start: s.start, end: s.end, breakMin: s.breakMin };
  }
  return g;
}

export default function RosterView() {
  const [from, setFrom] = useState(() => weekStart(todayStr()));
  const [data, setData] = useState<RosterResponse | null>(null);
  const [grid, setGrid] = useState<Grid>({});
  const [orig, setOrig] = useState<Grid>({});
  const [storeFilter, setStoreFilter] = useState('all');
  const [editing, setEditing] = useState<{ staff: Staff; date: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [reload, setReload] = useState(0);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(from, i)), [from]);
  const today = todayStr();

  const apply = useCallback((r: RosterResponse) => {
    const g = gridFrom(r);
    setData(r);
    setGrid(g);
    setOrig(g);
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

  const dirty = Object.keys({ ...grid, ...orig }).filter((k) => !same(grid[k], orig[k]));

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
      const prevGrid = gridFrom(prev);
      const valid = new Set(prev.shiftTypes.filter((t) => t.active).map((t) => t.id));
      const g = { ...grid };
      for (const s of staff) {
        days.forEach((d, i) => {
          const v = prevGrid[key(addDays(from, i - 7), s.id)];
          g[key(d, s.id)] = v && valid.has(v.typeId) ? { ...v } : null;
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
      const cells: RosterCell[] = [];
      for (const k of dirty) {
        const [date, staffId] = k.split('|');
        const v = grid[k];
        if (!v) cells.push({ date, staffId, shiftTypeId: null });
        else if (v.typeId) cells.push({ date, staffId, shiftTypeId: v.typeId, start: v.start, end: v.end, breakMin: v.breakMin });
      }
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
                  const v = grid[k] ?? null;
                  const t = v ? typeById.get(v.typeId) : undefined;
                  const adjusted = !!v && isAdjusted(v, t);
                  const isDirty = !same(grid[k], orig[k]);
                  return (
                    <td key={d}>
                      <button
                        type="button"
                        className={`cell ${t ? `cell-t${toneOf.get(t.id)}` : v ? 'cell-custom' : 'cell-off'} ${isDirty ? 'cell-dirty' : ''}`}
                        aria-label={`${s.nickname || s.name} ${d}`}
                        onClick={() => setEditing({ staff: s, date: d })}
                      >
                        <span className="cell-label">
                          {v ? (
                            <>
                              <strong>
                                {t?.name ?? 'กำหนดเอง'}
                                {adjusted && <span className="cell-adj"> ✎</span>}
                              </strong>
                              <span className="cell-time">
                                {v.start}–{v.end}
                              </span>
                              {t && t.storeId !== s.storeId && <em>{short.get(t.storeId)}</em>}
                            </>
                          ) : (
                            <span className="muted">หยุด</span>
                          )}
                        </span>
                      </button>
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
        แตะช่องเพื่อเลือกกะ หรือปรับเวลาเฉพาะคนเฉพาะวัน (✎ = ปรับเวลาจากปกติ) · 1 คนมีได้ 1 กะต่อวัน
      </p>

      {editing && (
        <ShiftEditor
          staff={editing.staff}
          date={editing.date}
          value={grid[key(editing.date, editing.staff.id)] ?? null}
          types={types}
          stores={data.stores.filter((st) => st.active)}
          onClose={() => setEditing(null)}
          onDone={(v) => {
            setGrid({ ...grid, [key(editing.date, editing.staff.id)]: v });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ShiftEditor({
  staff,
  date,
  value,
  types,
  stores,
  onClose,
  onDone,
}: {
  staff: Staff;
  date: string;
  value: CellVal | null;
  types: ShiftType[];
  stores: Store[];
  onClose: () => void;
  onDone: (v: CellVal | null) => void;
}) {
  const [v, setV] = useState<CellVal | null>(value && value.typeId ? { ...value } : null);
  const t = v ? types.find((x) => x.id === v.typeId) : undefined;
  const legacy = !!value && !value.typeId;
  const [touched, setTouched] = useState(false);

  function pick(type: ShiftType | null) {
    setTouched(true);
    if (!type) return setV(null);
    // Switching to another shift resets the times to that shift's defaults
    setV(v && v.typeId === type.id ? v : { typeId: type.id, start: type.start, end: type.end, breakMin: type.breakMin });
  }

  const valid = !v || (/^\d{2}:\d{2}$/.test(v.start) && /^\d{2}:\d{2}$/.test(v.end) && v.start !== v.end && v.breakMin >= 0);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="แก้ไขกะ" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <strong>{staff.nickname || staff.name}</strong>
            <div className="muted small">{fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          </div>
          <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="ปิด">
            ×
          </button>
        </div>

        {legacy && (
          <p className="small t-amber">
            ตอนนี้เป็นกะกำหนดเอง {value!.start}–{value!.end} (แก้ใน Sheet) · เลือกกะด้านล่างเพื่อแทนที่
          </p>
        )}

        <div className="sheet-options">
          <button className={`opt ${!v && !(legacy && !touched) ? 'active' : ''}`} onClick={() => pick(null)}>
            หยุด
          </button>
          {stores.map((st) => {
            const list = types.filter((x) => x.storeId === st.id);
            if (!list.length) return null;
            return (
              <div key={st.id} className="opt-group">
                <div className="opt-store">{st.name}</div>
                {list.map((x) => (
                  <button key={x.id} className={`opt ${v?.typeId === x.id ? 'active' : ''}`} onClick={() => pick(x)}>
                    <strong>{x.name}</strong> {x.start}–{x.end}
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        {v && t && (
          <div className="sheet-times">
            <div className="row-between">
              <strong>ปรับเวลาเฉพาะวันนี้</strong>
              {isAdjusted(v, t) && (
                <button className="link small" onClick={() => setV({ ...v, start: t.start, end: t.end, breakMin: t.breakMin })}>
                  ใช้เวลาปกติ
                </button>
              )}
            </div>
            <div className="time-row">
              <label>
                เริ่ม
                <input type="time" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value.slice(0, 5) })} />
              </label>
              <label>
                เลิก
                <input type="time" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value.slice(0, 5) })} />
              </label>
              <label>
                พัก (นาที)
                <input
                  type="number"
                  min={0}
                  max={240}
                  step={5}
                  value={v.breakMin}
                  onChange={(e) => setV({ ...v, breakMin: Math.max(0, Math.min(240, Number(e.target.value) || 0)) })}
                />
              </label>
            </div>
            {valid && (
              <p className="small muted">
                ทำงาน {fmtMin(workMinutes(v.start, v.end, v.breakMin))}
                {v.end < v.start && ' · เลิกวันถัดไป'}
                {isAdjusted(v, t) && ` · ปกติ ${t.start}–${t.end} พัก ${t.breakMin} นาที`}
              </p>
            )}
          </div>
        )}

        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>
            ยกเลิก
          </button>
          <button className="btn btn-primary" disabled={!valid} onClick={() => onDone(legacy && !touched ? value : v)}>
            ตกลง
          </button>
        </div>
      </div>
    </div>
  );
}
