import Link from 'next/link';
import { Production, date, operationNames } from '../shared/models';
import { Badge } from './ui';
export default function ProductionList({
  productions,
}: {
  productions: Production[];
}) {
  return (
    <div className="stack">
      {productions.map((p) => (
        <article
          key={p.id}
          data-production-id={p.id}
          className="production-row"
        >
          <div className="row">
            <strong>{p.title}</strong>
            <Badge status={p.status} />
          </div>
          <p className="muted small">
            {date(p.createdAt)} ·{' '}
            {operationNames[p.currentStage] ?? p.currentStage} ·{' '}
            {p.clips.length} corte(s) disponível(is)
          </p>
          {p.message && <p>{p.message}</p>}
          {typeof p.options?.burnSubtitles === 'boolean' && (
            <p className="muted small">
              {p.options.burnSubtitles ? 'Com legendas' : 'Sem legendas'}
            </p>
          )}
          <Link
            className="button secondary"
            href={`/criar?producao=${p.id}`}
            prefetch={false}
          >
            Acompanhar
          </Link>
          <details className="advanced">
            <summary>Detalhes das etapas</summary>
            <ul>
              {p.steps.map((s) => (
                <li key={s.id}>
                  {operationNames[s.operation]}: <Badge status={s.status} />
                  {s.error && <p>{s.error}</p>}
                </li>
              ))}
            </ul>
          </details>
        </article>
      ))}
    </div>
  );
}
