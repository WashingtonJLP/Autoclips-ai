import Link from 'next/link';
import { statusNames } from '../shared/models';
import Icon from './glyph';
export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      <div className="header-actions">{children}</div>
    </header>
  );
}
export function Badge({ status }: { status: string }) {
  return (
    <span
      className={`badge ${status === 'FAILED' ? 'danger' : ['PROCESSING', 'RETRYING', 'SCHEDULED', 'QUEUED'].includes(status) ? 'warning' : 'success'}`}
    >
      {statusNames[status] ?? status}
    </span>
  );
}
export function Feedback({
  error,
  message,
  loading,
}: {
  error?: string;
  message?: string;
  loading?: boolean;
}) {
  return (
    <>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      {loading && (
        <p className="loading-line" role="status">
          <span className="spinner" /> Atualizando dados…
        </p>
      )}
    </>
  );
}
export function Empty({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name="video" size={28} />
      </span>
      <h3>{title}</h3>
      <p className="muted">{description}</p>
      {href && (
        <Link className="button primary" href={href} prefetch={false}>
          {action ?? 'Criar cortes'}
          <Icon name="arrow" size={16} />
        </Link>
      )}
    </div>
  );
}
export function Pagination({
  current,
  pages,
  total,
  onChange,
}: {
  current: number;
  pages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (!total) return null;
  return (
    <nav className="pagination" aria-label="Paginação">
      <span>
        {total} resultados · página {current} de {pages}
      </span>
      <div>
        <button
          className="button subtle"
          disabled={current <= 1}
          onClick={() => onChange(current - 1)}
        >
          Anterior
        </button>
        <button
          className="button subtle"
          disabled={current >= pages}
          onClick={() => onChange(current + 1)}
        >
          Próxima
        </button>
      </div>
    </nav>
  );
}
export function Advanced({
  value,
  title = 'Informações avançadas',
}: {
  value: unknown;
  title?: string;
}) {
  return (
    <details className="advanced">
      <summary>{title}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
export function Refresh({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="button secondary" onClick={onClick} disabled={disabled}>
      <Icon name="refresh" size={16} />
      Atualizar
    </button>
  );
}
