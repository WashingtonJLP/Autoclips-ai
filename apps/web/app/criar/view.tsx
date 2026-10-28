'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, useAction, useResources } from '../shared/api';
import {
  Task,
  Source,
  descendants,
  paginate,
  statusNames,
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
import ProductionForm from '../components/production-form';
import TaskList from '../components/task-list';
import Icon from '../components/glyph';
export default function CreateView({
  initialTask,
  initialSource,
}: {
  initialTask?: string;
  initialSource?: string;
}) {
  const { data, loading, error, refresh } = useResources([
    'sources',
    'jobs',
    ...(initialTask ? [`jobs/${initialTask}`] : []),
  ]);
  const sources = (data.sources ?? []) as Source[],
    tasks = (data.jobs ?? []) as Task[],
    router = useRouter(),
    action = useAction();
  const [page, setPage] = useState(1),
    [status, setStatus] = useState(''),
    [started, setStarted] = useState<Task | null>(null);
  const rootId = initialTask ?? started?.id,
    root = rootId
      ? ((data[`jobs/${rootId}`] as Task | undefined) ??
        tasks.find((t) => t.id === rootId) ??
        started)
      : null;
  const chain = root
      ? descendants([root, ...tasks.filter((t) => t.id !== root.id)], root.id)
      : [],
    results = chain.filter(
      (t) => t.operation === 'clip' && t.status === 'COMPLETED',
    );
  const list = paginate(
    tasks.filter((t) => !status || t.status === status),
    page,
    6,
  );
  const allSteps = [
    ['download', 'Coleta de mídia'],
    ['transcribe', 'Transcrição'],
    ['select', 'Seleção de trechos'],
    ['clip', 'Vídeos e legendas'],
  ];
  const steps = allSteps.slice(
    Math.max(
      0,
      allSteps.findIndex(([operation]) => operation === root?.operation),
    ),
  );
  const pending = chain.find(
    (task) =>
      task.autoRun && task.status === 'COMPLETED' && !task.continuationDone,
  );
  return (
    <>
      <PageHeader
        eyebrow="PRODUÇÃO"
        title="Criar cortes"
        description="Da mídia autorizada ao vídeo pronto, com etapas claras."
      >
        <Refresh onClick={() => void refresh()} disabled={loading} />
      </PageHeader>
      <Feedback
        error={error || action.error}
        message={action.message}
        loading={loading}
      />
      <div className="two-columns">
        <ProductionForm
          initialSource={initialSource}
          sources={sources}
          tasks={tasks}
          onCreated={(task) => {
            setStarted(task);
            router.replace(`/criar?producao=${task.id}`);
            void refresh();
          }}
        />
        <aside className="panel">
          <h2>{root ? 'Acompanhar produção' : 'Tudo pronto para começar'}</h2>
          {!root ? (
            <>
              <p className="panel-intro">
                Escolha a fonte e a mídia. Depois de iniciar, acompanhe o
                andamento por aqui.
              </p>
              <div className="info-card">
                <Icon name="check" />
                <h3>Uma etapa de cada vez</h3>
                <p>
                  A produção continua em segundo plano. Use Atualizar para
                  consultar o progresso quando quiser.
                </p>
              </div>
              <p className="muted small" style={{ marginTop: 18 }}>
                A publicação permanece em simulação. Revise o resultado antes de
                agendar.
              </p>
            </>
          ) : (
            <>
              <p className="panel-intro">
                Atualize para acompanhar as etapas desta produção.
              </p>
              <div className="progress-steps">
                {steps.map(([operation, label], i) => {
                  const records = chain.filter(
                      (t) => t.operation === operation,
                    ),
                    done =
                      records.length > 0 &&
                      records.every((t) => t.status === 'COMPLETED');
                  const state =
                    records.find((t) => t.status === 'FAILED')?.status ??
                    records.find((t) => t.status !== 'COMPLETED')?.status;
                  return (
                    <div
                      key={operation}
                      className={`progress-step ${done ? 'done' : ''}`}
                    >
                      <span>
                        {done ? <Icon name="check" size={15} /> : i + 1}
                      </span>
                      <span>{label}</span>
                      {done ? (
                        <Badge status="COMPLETED" />
                      ) : state ? (
                        <Badge status={state} />
                      ) : (
                        <span className="muted">Aguardando</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {chain.some((t) => t.error) && (
                <p className="inline-error">
                  {chain.find((t) => t.error)?.error}
                </p>
              )}
              {pending && (
                <button
                  className="button secondary"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await api(`jobs/${pending.id}/continue`, {});
                      await refresh();
                    }, 'Continuação solicitada.')
                  }
                >
                  Retomar fluxo automático
                </button>
              )}
              {root.operation === 'transcribe' &&
                root.status === 'COMPLETED' &&
                !root.autoRun && (
                  <Link
                    className="button primary"
                    href="/biblioteca?aba=trechos"
                    prefetch={false}
                  >
                    Revisar e selecionar trechos
                  </Link>
                )}
              {results.length > 0 && (
                <div className="notice success">
                  <strong>{results.length} corte(s) pronto(s)</strong>
                  <p>Abra a biblioteca para assistir e baixar.</p>
                  <Link
                    className="button primary"
                    style={{ marginTop: 12 }}
                    href={`/biblioteca?video=${results[0].id}`}
                    prefetch={false}
                  >
                    Ver resultado
                    <Icon name="arrow" size={16} />
                  </Link>
                </div>
              )}
              <Advanced
                value={{ root, steps: chain }}
                title="Detalhes técnicos da produção"
              />
            </>
          )}
        </aside>
      </div>
      <section style={{ marginTop: 32 }}>
        <div className="section-heading">
          <h2>Tarefas recentes</h2>
          <label>
            <span className="filter-label">Status</span>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
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
        <div className="panel">
          {list.items.length ? (
            <TaskList tasks={list.items} sources={sources} />
          ) : (
            !loading &&
            !error && (
              <Empty
                title="Nenhuma tarefa encontrada"
                description="Inicie uma produção ou altere o filtro."
              />
            )
          )}
          <Pagination {...list} onChange={setPage} />
        </div>
      </section>
    </>
  );
}
