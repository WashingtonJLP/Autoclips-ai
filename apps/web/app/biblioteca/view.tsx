'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, useAction, useResources } from '../shared/api';
import {
  Source,
  Task,
  title,
  duration,
  paginate,
  statusNames,
  matchesTask,
} from '../shared/models';
import {
  PageHeader,
  Refresh,
  Feedback,
  Empty,
  Pagination,
  Badge,
  Advanced,
} from '../components/ui';
import ClipCard from '../components/clip-card';
import Preview from '../components/preview';
import SelectionResults from '../selection-results';
export default function LibraryView({
  initialTab,
  initialVideo,
}: {
  initialTab: string;
  initialVideo?: string;
}) {
  const { data, loading, error, refresh } = useResources([
      'jobs',
      'sources',
      ...(initialVideo ? [`jobs/${initialVideo}`] : []),
    ]),
    action = useAction();
  const tasks = (data.jobs ?? []) as Task[],
    sources = (data.sources ?? []) as Source[];
  const [tab, setTab] = useState(initialTab),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState(''),
    [page, setPage] = useState(1),
    [preview, setPreview] = useState<Task | null>(null);
  const focused = initialVideo
    ? (data[`jobs/${initialVideo}`] as Task | undefined)
    : undefined;
  const focusId = focused?.id;
  useEffect(() => {
    if (focused?.operation === 'clip' && focused.status === 'COMPLETED')
      setPreview(focused);
  }, [focusId]);
  const list = paginate(
    tasks
      .filter((t) =>
        tab === 'videos'
          ? t.operation === 'clip'
          : ['transcribe', 'select'].includes(t.operation),
      )
      .filter(
        (t) =>
          (!status || t.status === status) && matchesTask(t, sources, query),
      ),
    page,
    tab === 'videos' ? 8 : 4,
  );
  async function mutate(path: string, body: unknown, success: string) {
    await action.run(async () => {
      await api(path, body);
      await refresh();
    }, success);
  }
  return (
    <>
      <PageHeader
        eyebrow="SEUS RESULTADOS"
        title="Biblioteca"
        description="Assista, revise os trechos e encontre o próximo vídeo para agendar."
      >
        <Refresh onClick={() => void refresh()} disabled={loading} />
        <Link href="/criar" className="button primary" prefetch={false}>
          Criar cortes
        </Link>
      </PageHeader>
      <Feedback
        error={error || action.error}
        message={action.message}
        loading={loading}
      />
      <div className="tabs" aria-label="Conteúdo da biblioteca">
        {[
          ['videos', 'Vídeos'],
          ['trechos', 'Transcrições e trechos'],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <label>
          <span className="filter-label">Buscar</span>
          <input
            type="search"
            placeholder="Buscar pelo título ou pela fonte"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label style={{ maxWidth: 230 }}>
          <span className="filter-label">Status</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos os status</option>
            {['QUEUED', 'PROCESSING', 'RETRYING', 'COMPLETED', 'FAILED'].map(
              (s) => (
                <option key={s} value={s}>
                  {statusNames[s]}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      {!list.items.length && !loading && !error && (
        <Empty
          title="Nenhum resultado por aqui"
          description="Altere os filtros ou crie sua primeira produção."
          href="/criar"
        />
      )}
      <div className={tab === 'videos' ? 'clips-grid' : 'stack'}>
        {list.items.map((task) =>
          tab === 'videos' && task.status === 'COMPLETED' ? (
            <ClipCard task={task} key={task.id} onPreview={setPreview} />
          ) : (
            <article key={task.id} className="panel">
              <div className="row">
                <h2>{title(task, sources)}</h2>
                <Badge status={task.status} />
              </div>
              <p className="muted small" style={{ marginTop: 9 }}>
                {task.operation === 'select'
                  ? 'Seleção de trechos'
                  : task.operation === 'clip'
                    ? 'Corte vertical'
                    : 'Transcrição'}{' '}
                · {duration(task)}
              </p>
              {task.error && <p className="inline-error">{task.error}</p>}
              {task.operation === 'transcribe' &&
                task.status === 'COMPLETED' && (
                  <>
                    <details className="advanced">
                      <summary>Revisar transcrição</summary>
                      <p className="description" style={{ marginTop: 12 }}>
                        {(Array.isArray(task.result?.segments)
                          ? task.result.segments
                          : []
                        )
                          .map((s: { text: string }) => s.text)
                          .join(' ')}
                      </p>
                    </details>
                    <button
                      className="button primary"
                      style={{ marginTop: 18 }}
                      disabled={action.busy}
                      onClick={() =>
                        void mutate(
                          `jobs/${task.id}/select`,
                          {},
                          'Seleção enfileirada. Atualize para acompanhar.',
                        )
                      }
                    >
                      Selecionar trechos
                    </button>
                    {task.result?.transcript_path ? (
                      <a
                        className="button subtle"
                        style={{ marginLeft: 8 }}
                        href={`/api/backend/jobs/${task.id}/artifacts/transcript`}
                        download
                      >
                        Baixar transcrição
                      </a>
                    ) : null}
                  </>
                )}
              {task.operation === 'select' &&
                task.status === 'COMPLETED' &&
                task.result && (
                  <SelectionResults
                    result={task.result}
                    busy={action.busy}
                    onRender={(candidateId) =>
                      void mutate(
                        `jobs/${task.id}/render-selection`,
                        { candidateId },
                        'Renderização solicitada. O vídeo aparecerá na biblioteca.',
                      )
                    }
                  />
                )}
              {task.autoRun &&
                task.status === 'COMPLETED' &&
                !task.continuationDone && (
                  <button
                    className="button secondary"
                    style={{ marginTop: 14 }}
                    disabled={action.busy}
                    onClick={() =>
                      void mutate(
                        `jobs/${task.id}/continue`,
                        {},
                        'Continuação solicitada.',
                      )
                    }
                  >
                    Retomar fluxo automático
                  </button>
                )}
              <Advanced value={task} />
            </article>
          ),
        )}
      </div>
      <Pagination {...list} onChange={setPage} />
      <p className="muted small" style={{ marginTop: 14 }}>
        Consulta aos últimos 100 registros. Atualize quando quiser acompanhar
        novas etapas.
      </p>
      <Preview task={preview} onClose={() => setPreview(null)} />
    </>
  );
}
