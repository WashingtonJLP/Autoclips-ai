'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, useAction, useResources } from '../shared/api';
import {
  Task,
  Platforms,
  Publication,
  title,
  date,
  paginate,
} from '../shared/models';
import {
  PageHeader,
  Refresh,
  Feedback,
  Empty,
  Badge,
  Pagination,
  Advanced,
} from '../components/ui';
import Icon from '../components/glyph';
export default function PublicationsView({
  initialVideo,
}: {
  initialVideo?: string;
}) {
  const { data, loading, error, refresh } = useResources([
      'platforms',
      'jobs',
      ...(initialVideo ? [`jobs/${initialVideo}`] : []),
    ]),
    action = useAction();
  const settings = data.platforms as Platforms | undefined,
    tasks = (data.jobs ?? []) as Task[],
    selected = initialVideo
      ? (data[`jobs/${initialVideo}`] as Task | undefined)
      : undefined;
  const videos = [
    ...tasks,
    ...(selected && !tasks.some((t) => t.id === selected.id) ? [selected] : []),
  ].filter((t) => t.operation === 'clip' && t.status === 'COMPLETED');
  const [videoId, setVideoId] = useState(initialVideo ?? ''),
    [filter, setFilter] = useState(''),
    [page, setPage] = useState(1),
    [oauthConnected, setOauthConnected] = useState(false);
  useEffect(() => {
    setOauthConnected(
      new URLSearchParams(window.location.search).get('oauth') === 'connected',
    );
  }, []);
  const publications = (settings?.publications ?? []).filter(
      (p) => !filter || p.status === filter,
    ),
    list = paginate(publications, page, 8);
  async function schedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await action.run(async () => {
      await api<Publication>(`jobs/${videoId}/schedule`, {
        platform: form.get('platform'),
        scheduledAt: new Date(String(form.get('scheduledAt'))).toISOString(),
      });
      await refresh();
    }, 'Simulação agendada. Nenhum vídeo será publicado de verdade.');
  }
  return (
    <>
      <PageHeader
        eyebrow="DISTRIBUIÇÃO"
        title="Publicações"
        description="Conecte suas contas e organize os próximos agendamentos."
      >
        <Refresh onClick={() => void refresh()} disabled={loading} />
      </PageHeader>
      <p className="notice info">
        <strong>Modo simulado ativo.</strong> Agendamentos e testes não publicam
        vídeos reais.
      </p>
      <Feedback
        error={error || action.error}
        message={
          action.message ||
          (oauthConnected
            ? 'Conta conectada. A publicação continua em simulação.'
            : '')
        }
        loading={loading}
      />
      <div className="integration-grid">
        {['youtube', 'tiktok'].map((platform) => {
          const connected = settings?.accounts.some(
            (a) => a.platform === platform,
          );
          return (
            <section className="integration-card" key={platform}>
              <div className="row">
                <span className="integration-logo">
                  {platform === 'youtube' ? <Icon name="play" /> : '♪'}
                </span>
                <span className={`badge ${connected ? 'success' : ''}`}>
                  {connected ? 'Conta conectada' : 'Não conectada'}
                </span>
              </div>
              <h2>{platform === 'youtube' ? 'YouTube' : 'TikTok'}</h2>
              <p>
                {platform === 'youtube'
                  ? 'Conexão oficial para preparar a distribuição dos seus cortes.'
                  : 'Conexão sujeita às permissões e à aprovação do aplicativo TikTok.'}
              </p>
              <button
                className="button secondary"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    const result = await api<{ url: string }>('oauth/start', {
                      platform,
                    });
                    window.location.assign(result.url);
                  }, '')
                }
              >
                {connected ? 'Reconectar conta' : 'Conectar conta'}
              </button>
              {connected && (
                <button
                  className="button subtle"
                  style={{ marginLeft: 8 }}
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await api('oauth/refresh', { platform });
                      await refresh();
                    }, 'Autorização renovada.')
                  }
                >
                  Renovar autorização
                </button>
              )}
            </section>
          );
        })}
      </div>
      <section className="panel">
        <h2>Agendar um corte</h2>
        <p className="panel-intro">
          Selecione um vídeo concluído e escolha quando executar a simulação.
        </p>
        {!videos.length && !loading ? (
          <Empty
            title="Você ainda não tem cortes prontos"
            description="Finalize uma produção para agendar."
            href="/criar"
          />
        ) : (
          <form onSubmit={(e) => void schedule(e)} className="form-grid">
            <label className="span-all">
              Vídeo
              <select
                value={videoId}
                onChange={(e) => setVideoId(e.target.value)}
                required
              >
                <option value="">Selecione um corte</option>
                {videos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {title(t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Plataforma
              <select name="platform">
                <option value="youtube">YouTube</option>
                <option value="tiktok">TikTok</option>
              </select>
            </label>
            <label>
              Data e horário local
              <input name="scheduledAt" type="datetime-local" required />
            </label>
            <div className="span-all row">
              <span className="muted small">
                Repetir vídeo e plataforma reutiliza o agendamento existente.
              </span>
              <button
                className="button primary"
                disabled={action.busy || !videoId}
              >
                Agendar simulação
              </button>
            </div>
            {videoId && (
              <div className="span-all">
                <button
                  type="button"
                  className="text-link text-button"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(
                      () => api(`jobs/${videoId}/publish`, {}),
                      'Simulação concluída. Nenhum vídeo foi publicado.',
                    )
                  }
                >
                  Executar simulação agora
                </button>
              </div>
            )}
          </form>
        )}
      </section>
      <section style={{ marginTop: 30 }}>
        <div className="section-heading">
          <h2>Agendamentos e histórico</h2>
          <label>
            <span className="filter-label">Status</span>
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              <option value="SCHEDULED">Agendados</option>
              <option value="SIMULATED">Simulados</option>
            </select>
          </label>
        </div>
        {list.items.length ? (
          <div className="panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Vídeo</th>
                    <th>Plataforma</th>
                    <th>Agendamento</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {tasks.find((t) => t.id === p.taskId)
                          ? title(tasks.find((t) => t.id === p.taskId)!)
                          : 'Corte do histórico'}
                        <Advanced value={p} title="Detalhes avançados" />
                      </td>
                      <td>{p.platform === 'youtube' ? 'YouTube' : 'TikTok'}</td>
                      <td>{date(p.scheduledAt)}</td>
                      <td>
                        <Badge status={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...list} onChange={setPage} />
          </div>
        ) : (
          !loading &&
          !error && (
            <Empty
              title="Nenhum agendamento encontrado"
              description="Seus agendamentos e simulações aparecerão aqui."
            />
          )
        )}
        <p className="muted small" style={{ marginTop: 15 }}>
          Para assistir ou baixar os vídeos, abra a{' '}
          <Link href="/biblioteca" className="text-link" prefetch={false}>
            Biblioteca
          </Link>
          .
        </p>
      </section>
    </>
  );
}
