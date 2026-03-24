import type { PropsWithChildren, ReactNode } from 'react';

export function Panel({
  title,
  eyebrow,
  actions,
  children,
  className = '',
}: PropsWithChildren<{
  title?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}>) {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || eyebrow || actions) && (
        <header className="panel__header">
          <div>
            {eyebrow ? <p className="panel__eyebrow">{eyebrow}</p> : null}
            {title ? <h3>{title}</h3> : null}
          </div>
          {actions ? <div className="panel__actions">{actions}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  tone = 'neutral',
  detail,
}: {
  label: string;
  value: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warm';
  detail?: ReactNode;
}) {
  return (
    <div className={`metric-card metric-card--${tone}`}>
      <span className="metric-card__label">{label}</span>
      <strong className="metric-card__value">{value}</strong>
      {detail ? <span className="metric-card__detail">{detail}</span> : null}
    </div>
  );
}

export function StatusPill({
  value,
}: {
  value: string;
}) {
  const tone = value.toLowerCase();

  return <span className={`status-pill status-pill--${tone}`}>{value}</span>;
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

export function LoadingPanel({ label = 'Loading Monte data...' }: { label?: string }) {
  return (
    <div className="loading-panel" role="status" aria-live="polite">
      <span className="loading-panel__dot" />
      {label}
    </div>
  );
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="error-panel" role="alert">
      <strong>Could not load data.</strong>
      <span>{message}</span>
    </div>
  );
}

export function KeyValueGrid({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="key-value-grid">
      {items.map((item) => (
        <div key={item.label} className="key-value-grid__item">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MiniBar({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: ReactNode;
}) {
  return (
    <div className="mini-bar">
      <div className="mini-bar__header">
        <span>{label}</span>
        <strong>{Math.round(value * 100)}%</strong>
      </div>
      <div className="mini-bar__track">
        <div className="mini-bar__fill" style={{ width: `${Math.max(6, value * 100)}%` }} />
      </div>
      {hint ? <span className="mini-bar__hint">{hint}</span> : null}
    </div>
  );
}
