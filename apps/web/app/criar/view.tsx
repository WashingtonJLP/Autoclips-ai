'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, useAction, useResources } from '../shared/api';
import {
  Library,
  Task,
  operationNames,
  paginate,
  statusNames,
} from '../shared/models';
import {
  PageHeader,
  Feedback,
  Pagination,
  Badge,
  Advanced,
} from '../components/ui';
import ProductionForm from '../components/production-form';
import ProductionList from '../components/production-list';
const isActive = (status: string) =>
  ['QUEUED', 'PROCESSING', 'RETRYING'].includes(status);
export default function CreateView({
  initialTask,
  initialAsset,
}: {
  initialTask?: string;
  initialAsset?: string;
  initialSource?: string;
}) {
  const { data, loading, error, refresh } = useResources(['library']);
  const content = (data.library ?? { productions: [], clips: [] }) as Library;
  const [started, setStarted] = useState<Task | null>(null);
  const [awaitingRoot, setAwaitingRoot] = useState(false);
  const [saved, setSaved] = useState<string>();
  const [page, setPage] = useState(1),
    [status, setStatus] = useState('');
  const router = useRouter(),
    action = useAction();
  const rootId = initialTask ?? started?.id ?? saved;
  const production = content.productions.find((p) => p.id === rootId);
  const pending = started && awaitingRoot && !production;
  const running =
    content.productions.some((p) => p.hasActive || isActive(p.status)) ||
    !!pending;
  useEffect(() => {
    if (initialTask || started || saved) return;
    const id = localStorage.getItem('autoclips:active-production');
    if (
      id &&
      content.productions.some((p) => p.id === id && isActive(p.status))
    )
      setSaved(id);
  }, [initialTask, started, saved, content.productions]);
  useEffect(() => {
    if (production) setAwaitingRoot(false);
  }, [production]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [running, refresh]);
  const rows = paginate(
    content.productions.filter((p) => !status || p.status === status),
    page,
    6,
  );
  const stages = ['download', 'transcribe', 'select', 'clip'];
  const rootActive = production ? isActive(production.status) : !!pending;
  return (
    <>
      <PageHeader
        eyebrow="PRODUÇÃO"
        title="Criar cortes"
        description="Escolha o vídeo e as preferências. As etapas continuam automaticamente."
      />
      <Feedback
        error={error || action.error}
        loading={loading && !data.library}
      />
      <div className="two-columns">
        <ProductionForm
          initialAsset={initialAsset}
          inProgress={rootActive}
          onCreated={(task) => {
            setStarted(task);
            setAwaitingRoot(true);
            localStorage.setItem('autoclips:active-production', task.id);
            router.replace(`/criar?producao=${task.id}`);
            void refresh();
          }}
        />
        <aside className="panel" aria-label="Acompanhamento da produção">
          <h2>Acompanhamento</h2>
          {!rootId ? (
            <p>Cole uma URL ou escolha um arquivo para começar.</p>
          ) : (
            <>
              <h3>
                {production?.title ??
                  started?.editorial?.mediaTitle ??
                  'Preparando vídeo'}
              </h3>
              <p role="status">
                {production?.status === 'FAILED'
                  ? 'Falhou'
                  : rootActive
                    ? 'Produção em andamento'
                    : production
                      ? statusNames[production.status]
                      : loading || pending
                        ? 'Carregando produção...'
                        : 'Produção removida ou não encontrada.'}
              </p>
              <div className="progress-steps">
                {stages.map((operation) => {
                  const records =
                    production?.steps.filter(
                      (s) => s.operation === operation,
                    ) ?? [];
                  const reused =
                    !!production?.startOperation &&
                    stages.indexOf(operation) <
                      stages.indexOf(production.startOperation);
                  const stageStatus =
                    records.find((s) => s.status === 'FAILED')?.status ??
                    records.find((s) => s.status === 'CANCELLED')?.status ??
                    records.find((s) => s.status !== 'COMPLETED')?.status ??
                    (records.length ? 'COMPLETED' : undefined);
                  return (
                    <div
                      key={operation}
                      className={`progress-step ${stageStatus === 'COMPLETED' || reused ? 'done' : ''}`}
                    >
                      <span>{operationNames[operation]}</span>
                      {stageStatus ? (
                        <Badge status={stageStatus} />
                      ) : reused ? (
                        <span>Reutilizado</span>
                      ) : (
                        <span className="muted">Aguardando</span>
                      )}
                    </div>
                  );
                })}
                <div className="progress-step">
                  <span>Concluído</span>
                  {production?.status === 'COMPLETED' ? (
                    <Badge status="COMPLETED" />
                  ) : (
                    <span className="muted">
                      {production &&
                      [
                        'EMPTY',
                        'CLIPS_REMOVED',
                        'FAILED',
                        'CANCELLED',
                      ].includes(production.status)
                        ? statusNames[production.status]
                        : 'Aguardando'}
                    </span>
                  )}
                </div>
              </div>
              {production?.message && (
                <p
                  className={
                    production.status === 'FAILED' ? 'notice error' : 'notice'
                  }
                  role={production.status === 'FAILED' ? 'alert' : 'status'}
                >
                  {production.status === 'FAILED'
                    ? `${operationNames[production.currentStage]}: `
                    : ''}
                  {production.message}
                </p>
              )}
              {production?.canRetry && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await api(`productions/${production.id}/retry`, {});
                      await refresh();
                    }, '')
                  }
                >
                  Tentar novamente
                </button>
              )}
              {rootActive && rootId && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await api(`jobs/${rootId}/cancel`, {});
                      await refresh();
                    }, '')
                  }
                >
                  Cancelar produção
                </button>
              )}
              {!!production?.clips.length && (
                <div className="notice">
                  <strong>
                    {production.clips.length} corte(s) disponível(is)
                  </strong>
                  <p>
                    <Link
                      className="button secondary"
                      href={`/biblioteca?video=${production.clips[0].id}`}
                      prefetch={false}
                    >
                      Ver cortes na Biblioteca
                    </Link>
                  </p>
                </div>
              )}
              {production && (
                <Advanced value={production} title="Detalhes técnicos" />
              )}
            </>
          )}
        </aside>
      </div>
      <section style={{ marginTop: 32 }} aria-label="Tarefas recentes">
        <div className="section-heading">
          <h2>Tarefas recentes</h2>
          <label>
            Status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {[
                'QUEUED',
                'PROCESSING',
                'RETRYING',
                'COMPLETED',
                'FAILED',
                'CANCELLED',
                'EMPTY',
                'CLIPS_REMOVED',
              ].map((s) => (
                <option key={s} value={s}>
                  {statusNames[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="panel">
          {rows.items.length ? (
            <ProductionList productions={rows.items} />
          ) : (
            <p>Nenhuma produção nesta lista.</p>
          )}
          <Pagination {...rows} onChange={setPage} />
        </div>
      </section>
    </>
  );
}
