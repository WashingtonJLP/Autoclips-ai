'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, useAction, useResources } from '../shared/api';
import { Task, paginate, date } from '../shared/models';
import {
  PageHeader,
  Refresh,
  Feedback,
  Empty,
  Pagination,
  Badge,
} from '../components/ui';
import ClipCard from '../components/clip-card';
import Preview from '../components/preview';
type Production = {
  id: string;
  title: string;
  createdAt: string;
  testContent: boolean;
  status: string;
  error: string | null;
  clips: Task[];
  steps: { id: string; operation: string; status: string }[];
};
type Library = { productions: Production[]; clips: Task[] };
export default function LibraryView({
  initialTab,
  initialVideo,
}: {
  initialTab: string;
  initialVideo?: string;
}) {
  const { data, loading, error, refresh } = useResources(['library']);
  const content = (data.library ?? { productions: [], clips: [] }) as Library;
  const action = useAction();
  const [tab, setTab] = useState(initialVideo ? 'cortes' : initialTab);
  const [scope, setScope] = useState('real');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<Task | null>(null);
  const [removing, setRemoving] = useState<{
    id: string;
    label: string;
    production: boolean;
  } | null>(null);
  const [undo, setUndo] = useState<{ id: string; undoToken: string } | null>(
    null,
  );
  const focused = content.clips.find((t) => t.id === initialVideo);
  useEffect(() => {
    if (focused?.status === 'COMPLETED') {
      setPreview(focused);
      setScope(focused.testContent ? 'test' : 'real');
    }
  }, [focused?.id]);
  const running = content.productions.some((p) =>
    ['QUEUED', 'PROCESSING', 'RETRYING'].includes(p.status),
  );
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [running, refresh]);
  const productions = content.productions.filter(
    (p) => !!p.testContent === (scope === 'test'),
  );
  const clips = content.clips.filter(
    (p) => !!p.testContent === (scope === 'test'),
  );
  const matches = (s: string) =>
    s.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'));
  const productionList = paginate(
    productions.filter(
      (p) => (!status || p.status === status) && matches(p.title),
    ),
    page,
    6,
  );
  const clipList = paginate(
    clips.filter(
      (t) =>
        (!status || t.status === status) &&
        matches(t.editorial?.title ?? 'Corte'),
    ),
    page,
    8,
  );
  const list = tab === 'producoes' ? productionList : clipList;
  const askClip = (task: Task) =>
    setRemoving({
      id: task.id,
      label: task.editorial?.title ?? 'este corte',
      production: false,
    });
  return (
    <>
      <PageHeader
        eyebrow="SEUS RESULTADOS"
        title="Biblioteca"
        description="Produções e cortes, prontos para acompanhar, assistir e baixar."
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
          ['producoes', 'Produções'],
          ['cortes', 'Cortes'],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setPage(1);
              setStatus('');
            }}
          >
            {label} ({key === 'producoes' ? productions.length : clips.length})
          </button>
        ))}
      </div>
      <div className="toolbar">
        <label>
          Conteúdo
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setPage(1);
            }}
          >
            <option value="real">Minhas mídias</option>
            <option value="test">Testes sintéticos</option>
          </select>
        </label>
        <label>
          Buscar
          <input
            type="search"
            placeholder="Buscar pelo título"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
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
            <option value="QUEUED">Na fila</option>
            <option value="PROCESSING">Processando</option>
            <option value="RETRYING">Nova tentativa</option>
            <option value="COMPLETED">Concluído</option>
            <option value="FAILED">Falhou</option>
            <option value="CANCELLED">Cancelado</option>
          </select>
        </label>
      </div>
      <p className="muted small">
        {scope === 'test'
          ? 'Conteúdo sintético separado das suas mídias.'
          : 'Mídias de teste ficam separadas em Testes sintéticos.'}{' '}
        {clips.filter((t) => t.status === 'COMPLETED').length} corte(s)
        pronto(s).
      </p>
      {removing && (
        <section
          className="notice"
          role="region"
          aria-label="Confirmar exclusão"
        >
          <h2>Excluir {removing.production ? 'produção' : 'corte'}?</h2>
          <p>
            {removing.label}.{' '}
            {removing.production
              ? 'A produção e seus cortes exclusivos sairão da Biblioteca. Etapas compartilhadas com outras produções serão preservadas.'
              : 'Os outros cortes da produção serão preservados.'}{' '}
            Você poderá desfazer. Arquivos originais não serão apagados.
          </p>
          <button
            className="button secondary"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const result = await api<{ id: string; undoToken: string }>(
                  `jobs/${removing.id}/remove`,
                  {},
                );
                setUndo(result);
                setRemoving(null);
                setPreview(null);
                await refresh();
              }, 'Item excluído da Biblioteca. Você pode desfazer.')
            }
          >
            Confirmar exclusão
          </button>
          <button className="button subtle" onClick={() => setRemoving(null)}>
            Cancelar
          </button>
        </section>
      )}
      {undo && (
        <p role="status">
          Item excluído.{' '}
          <button
            className="button subtle"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await api(`jobs/${undo.id}/restore`, {
                  undoToken: undo.undoToken,
                });
                setUndo(null);
                await refresh();
              }, 'Exclusão desfeita. Produções canceladas não são reiniciadas automaticamente.')
            }
          >
            Desfazer exclusão
          </button>
        </p>
      )}
      {!list.items.length && !loading && !error && (
        <Empty
          title="Nenhum resultado nesta lista"
          description="Altere os filtros ou crie uma produção."
          href="/criar"
        />
      )}
      {tab === 'producoes' ? (
        <div className="stack">
          {productionList.items.map((p) => (
            <article className="panel" key={p.id}>
              <div className="row">
                <h2>{p.title}</h2>
                <Badge status={p.status} />
              </div>
              <p className="muted small">
                {date(p.createdAt)} ·{' '}
                {p.clips.filter((t) => t.status === 'COMPLETED').length}{' '}
                corte(s) pronto(s)
              </p>
              {p.error && <p className="inline-error">{p.error}</p>}
              <div className="row">
                <Link
                  className="button secondary"
                  href={`/criar?producao=${p.id}`}
                  prefetch={false}
                >
                  Acompanhar produção
                </Link>
                <button
                  className="button subtle"
                  onClick={() =>
                    setRemoving({ id: p.id, label: p.title, production: true })
                  }
                >
                  Excluir produção
                </button>
              </div>
              <details className="advanced">
                <summary>Etapas e cortes ({p.clips.length})</summary>
                <ul>
                  {p.steps.map((s) => (
                    <li key={s.id}>
                      {(
                        {
                          download: 'Importação',
                          transcribe: 'Transcrição',
                          select: 'Seleção',
                          clip: 'Renderização',
                        } as Record<string, string>
                      )[s.operation] ?? s.operation}
                      : <Badge status={s.status} />
                    </li>
                  ))}
                </ul>
                <div className="clips-grid">
                  {p.clips.map((t) => (
                    <ClipCard
                      key={t.id}
                      task={t}
                      onPreview={setPreview}
                      onRemove={askClip}
                    />
                  ))}
                </div>
              </details>
            </article>
          ))}
        </div>
      ) : (
        <div className="clips-grid">
          {clipList.items.map((t) => (
            <ClipCard
              key={t.id}
              task={t}
              onPreview={setPreview}
              onRemove={askClip}
            />
          ))}
        </div>
      )}
      <Pagination {...list} onChange={setPage} />
      <Preview
        task={preview}
        onClose={() => setPreview(null)}
        onRemove={askClip}
      />
    </>
  );
}
