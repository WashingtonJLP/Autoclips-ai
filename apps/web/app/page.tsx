'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useResources } from './shared/api';
import { Task, Platforms, Source, active } from './shared/models';
import { PageHeader, Feedback, Empty, Refresh } from './components/ui';
import ClipCard from './components/clip-card';
import Preview from './components/preview';
import TaskList from './components/task-list';
import Icon from './components/glyph';
export default function Overview() {
  const { data, loading, error, refresh } = useResources([
    'jobs',
    'sources',
    'platforms',
    'health',
  ]);
  const tasks = (data.jobs ?? []) as Task[],
    sources = (data.sources ?? []) as Source[],
    platforms = data.platforms as Platforms | undefined;
  const clips = tasks.filter(
      (t) => t.operation === 'clip' && t.status === 'COMPLETED',
    ),
    [preview, setPreview] = useState<Task | null>(null);
  const metrics = [
    [
      'Produções',
      tasks.filter((t) => !t.parentId).length,
      'Nos últimos registros',
      'video',
    ],
    [
      'Em andamento',
      tasks.filter(active).length,
      'Tarefas na fila ou processando',
      'clock',
    ],
    ['Cortes prontos', clips.length, 'Disponíveis na biblioteca', 'library'],
    [
      'Agendamentos',
      platforms?.publications.filter((p) => p.status === 'SCHEDULED').length ??
        0,
      'Publicação em simulação',
      'publish',
    ],
  ] as const;
  return (
    <>
      <PageHeader
        eyebrow="SEU ESTÚDIO, EM UM SÓ LUGAR"
        title="Visão geral"
        description="Acompanhe suas produções e transforme boas ideias em novos cortes."
      >
        <Refresh onClick={() => void refresh()} disabled={loading} />
        <Link href="/criar" prefetch={false} className="button primary">
          <Icon name="create" size={18} />
          Criar cortes
        </Link>
      </PageHeader>
      <Feedback error={error} loading={loading} />
      <section className="metrics-grid" aria-label="Indicadores recentes">
        {metrics.map(([label, value, note, icon]) => (
          <article className="metric" key={label}>
            <div className="row">
              <span>{label}</span>
              <span className="metric-icon">
                <Icon name={icon} />
              </span>
            </div>
            <strong>{loading && !data.jobs ? '—' : value}</strong>
            <p>{note}</p>
          </article>
        ))}
      </section>
      <section className="overview-banner">
        <div>
          <span className="eyebrow">DA FONTE AO CORTE FINAL</span>
          <h2>Seu próximo vídeo começa aqui.</h2>
          <p>
            Escolha uma mídia autorizada. Transcrição, seleção e legendas seguem
            no mesmo fluxo.
          </p>
          <Link href="/criar" prefetch={false} className="button primary">
            Nova produção
            <Icon name="arrow" size={16} />
          </Link>
        </div>
        <div className="banner-art" aria-hidden="true">
          <span>✦</span>
          <div className="art-film">
            <Icon name="play" size={38} />
          </div>
          <div className="art-wave">▂ ▅ ▃ ▇ ▄ ▆ ▂ ▅</div>
        </div>
      </section>
      <section>
        <div className="section-heading">
          <div>
            <h2>Cortes recentes</h2>
            <p className="muted">Prontos para assistir, revisar e agendar.</p>
          </div>
          <Link className="text-link" href="/biblioteca" prefetch={false}>
            Ver biblioteca →
          </Link>
        </div>
        {!clips.length && !loading ? (
          <Empty
            title="Sua biblioteca começa com o primeiro corte"
            description="Crie uma produção ou descubra uma fonte autorizada."
            href="/criar"
          />
        ) : (
          <div className="clips-grid overview-clips">
            {clips.slice(0, 4).map((task) => (
              <ClipCard key={task.id} task={task} onPreview={setPreview} />
            ))}
          </div>
        )}
      </section>
      <div className="overview-bottom">
        <section className="panel">
          <div className="section-heading">
            <h2>Últimas atividades</h2>
            <Link href="/criar" className="text-link" prefetch={false}>
              Ver tarefas →
            </Link>
          </div>
          {tasks.length ? (
            <TaskList tasks={tasks.slice(0, 4)} sources={sources} />
          ) : (
            <p className="muted">Nenhuma atividade registrada.</p>
          )}
        </section>
        <section className="panel service-panel">
          <h2>Estado do ambiente</h2>
          <div className="service-row">
            <span>Dashboard</span>
            <span className="badge success">Disponível</span>
          </div>
          <div className="service-row">
            <span>API principal</span>
            <span className={`badge ${data.health ? 'success' : 'warning'}`}>
              {data.health
                ? 'Conectada'
                : loading
                  ? 'Verificando'
                  : 'Não confirmada'}
            </span>
          </div>
          <div className="service-row">
            <span>Publicação</span>
            <span className="badge warning">Simulação</span>
          </div>
          <p className="muted small">
            Atualização manual. Os indicadores abrangem os últimos 100
            registros.
          </p>
          <Link href="/configuracoes" className="text-link" prefetch={false}>
            Ver informações do sistema →
          </Link>
        </section>
      </div>
      <Preview task={preview} onClose={() => setPreview(null)} />
    </>
  );
}
