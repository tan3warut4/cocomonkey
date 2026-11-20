import type { DayFlag } from '@shared/types';
import type { ReactNode } from 'react';
import { FLAG_LABEL, FLAG_TONE } from '../lib/format';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center-msg">
      <div className="spinner" aria-hidden />
      {label && <p className="muted">{label}</p>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert alert-red" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button className="btn btn-small btn-ghost" onClick={onRetry}>
          ลองใหม่
        </button>
      )}
    </div>
  );
}

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || action) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Flags({ flags }: { flags: DayFlag[] }) {
  return (
    <span className="flags">
      {flags.map((f) => (
        <span key={f} className={`badge badge-${FLAG_TONE[f]}`}>
          {FLAG_LABEL[f]}
        </span>
      ))}
    </span>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: string }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Pager({ label, onPrev, onNext, onToday }: { label: string; onPrev: () => void; onNext: () => void; onToday?: () => void }) {
  return (
    <div className="pager">
      <button className="btn btn-icon" onClick={onPrev} aria-label="ก่อนหน้า">
        ‹
      </button>
      <button className="pager-label" onClick={onToday} disabled={!onToday}>
        {label}
      </button>
      <button className="btn btn-icon" onClick={onNext} aria-label="ถัดไป">
        ›
      </button>
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" />
    </svg>
  );
}
