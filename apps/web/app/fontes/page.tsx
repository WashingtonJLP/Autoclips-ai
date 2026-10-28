'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, useAction, useResources } from '../shared/api';
import { Task, Source, paginate, date } from '../shared/models';
import {
  PageHeader,
  Refresh,
  Feedback,
  Empty,
  Pagination,
  Advanced,
} from '../components/ui';
import SourceForm from '../components/source-form';
type Candidate = {
  reference: string;
  name: string;
  license: string;
  evidenceUrl: string;
  attribution: string;
};
export default function Sources() {
  const { data, loading, error, refresh } = useResources(['sources']),
    action = useAction(),
    router = useRouter();
  const [tab, setTab] = useState('minhas'),
    [query, setQuery] = useState(''),
    [license, setLicense] = useState(''),
    [page, setPage] = useState(1),
    [connector, setConnector] = useState('commons'),
    [candidates, setCandidates] = useState<Candidate[] | null>(null),
    [reviewed, setReviewed] = useState<Record<string, boolean>>({}),
    [saved, setSaved] = useState('');
  const sources = (data.sources ?? []) as Source[],
    list = paginate(
      sources.filter(
        (s) =>
          s.name.toLowerCase().includes(query.toLowerCase()) &&
          (!license || s.license === license),
      ),
      page,
      6,
    ),
    discoveries = paginate(candidates ?? [], page, 6);
  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved('');
    const form = new FormData(event.currentTarget);
    await action.run(async () => {
      const result = await api<Candidate[]>('discovery/search', {
        connector,
        query: String(form.get('query')),
      });
      setCandidates(result);
      setReviewed({});
      setPage(1);
    }, 'Busca concluída. Revise a licença antes de importar.');
  }
  async function importVideo(item: Candidate) {
    setSaved('');
    const result = await action.run(
      () =>
        api<Task>('discovery/import', {
          connector,
          reference: item.reference,
          commercialUseVerified: true,
          autoRun: true,
        }),
      'Coleta e produção enfileiradas.',
    );
    if (result) router.push(`/criar?producao=${result.id}`);
  }
  return (
    <>
      <PageHeader
        eyebrow="ORIGEM E DIREITOS"
        title="Fontes"
        description="Encontre conteúdo autorizado e mantenha suas evidências organizadas."
      >
        <Refresh onClick={() => void refresh()} disabled={loading} />
        <button
          className="button primary"
          onClick={() => {
            setSaved('');
            setTab('cadastrar');
            setPage(1);
          }}
          disabled={action.busy}
        >
          Cadastrar fonte
        </button>
      </PageHeader>
      <Feedback
        error={error || action.error}
        message={saved || action.message}
        loading={loading}
      />
      <div className="tabs" aria-label="Gerenciamento de fontes">
        {[
          ['minhas', 'Minhas fontes'],
          ['descobrir', 'Descobrir vídeos'],
          ['cadastrar', 'Cadastrar fonte'],
        ].map(([key, label]) => (
          <button
            key={key}
            disabled={action.busy}
            aria-pressed={tab === key}
            onClick={() => {
              setSaved('');
              setTab(key);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'cadastrar' && (
        <div className="two-columns">
          <SourceForm
            onSaved={() => {
              setSaved('Fonte cadastrada com evidência de direitos.');
              setTab('minhas');
              void refresh();
            }}
          />
          <aside className="info-card">
            <h3>Direitos antes da produção</h3>
            <p>
              Confirme a autoria, a licença e os direitos de imagem e música.
              CC0 e CC BY não garantem monetização.
            </p>
            <p>
              A evidência fica vinculada à fonte para consulta durante toda a
              produção.
            </p>
          </aside>
        </div>
      )}
      {tab === 'minhas' && (
        <>
          <div className="toolbar">
            <label>
              <span className="filter-label">Buscar fonte</span>
              <input
                type="search"
                placeholder="Nome da fonte"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label style={{ maxWidth: 230 }}>
              <span className="filter-label">Licença</span>
              <select
                value={license}
                onChange={(e) => {
                  setLicense(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Todas as licenças</option>
                <option value="CC0">CC0</option>
                <option value="CC-BY-4.0">CC BY 4.0</option>
                <option value="PERMISSION">Permissão expressa</option>
              </select>
            </label>
          </div>
          <div className="source-grid">
            {list.items.map((source) => (
              <article className="source-card" key={source.id}>
                <div className="row">
                  <span className="badge">{source.license}</span>
                  <span
                    className={`badge ${source.commercialUseVerified ? 'success' : 'warning'}`}
                  >
                    {source.commercialUseVerified
                      ? 'Direitos revisados'
                      : 'Revisão pendente'}
                  </span>
                </div>
                <h3>{source.name}</h3>
                <p>Revisada em {date(source.verifiedAt)}</p>
                <div className="row">
                  <a
                    className="text-link"
                    href={source.evidenceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver evidência ↗
                  </a>
                  <Link
                    className="button subtle"
                    href={`/criar?fonte=${source.id}`}
                    prefetch={false}
                  >
                    Usar fonte
                  </Link>
                </div>
                <details style={{ marginTop: 16 }}>
                  <summary>Créditos e origem</summary>
                  <p>{source.attribution}</p>
                  <a
                    className="text-link"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir origem ↗
                  </a>
                </details>
                <Advanced
                  value={source}
                  title="Registro avançado de direitos"
                />
              </article>
            ))}
          </div>
          {!list.items.length && !loading && !error && (
            <Empty
              title="Nenhuma fonte encontrada"
              description="Cadastre uma fonte ou descubra vídeos com licença autorizada."
            />
          )}
          <Pagination {...list} onChange={setPage} />
        </>
      )}
      {tab === 'descobrir' && (
        <>
          <form className="panel" onSubmit={(e) => void search(e)}>
            <h2>Encontre sua próxima fonte</h2>
            <p className="panel-intro">
              Busque por tema e revise a evidência antes de iniciar a coleta.
            </p>
            <div className="toolbar">
              <label>
                <span className="filter-label">Catálogo</span>
                <select
                  value={connector}
                  disabled={action.busy}
                  onChange={(e) => {
                    setConnector(e.target.value);
                    setCandidates(null);
                    setReviewed({});
                  }}
                >
                  <option value="commons">Wikimedia Commons</option>
                  <option value="manifest">Catálogo autorizado</option>
                </select>
              </label>
              <label>
                <span className="filter-label">Tema do vídeo</span>
                <input
                  name="query"
                  required
                  maxLength={200}
                  placeholder="Ex.: natureza, ciência, educação"
                  disabled={action.busy}
                />
              </label>
              <button
                className="button primary"
                disabled={action.busy}
                style={{ alignSelf: 'end' }}
              >
                {action.busy ? 'Buscando…' : 'Buscar vídeos'}
              </button>
            </div>
          </form>
          <p className="muted small" style={{ margin: '16px 0' }}>
            Os catálogos retornam apenas licenças aceitas. Verifique também os
            direitos de terceiros.
          </p>
          <div className="source-grid">
            {discoveries.items.map((item) => (
              <article className="source-card" key={item.reference}>
                <span className="badge success">{item.license}</span>
                <h3>{item.name}</h3>
                <p>{item.attribution}</p>
                <a
                  href={item.evidenceUrl}
                  className="text-link"
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir evidência da licença ↗
                </a>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={reviewed[item.reference] ?? false}
                    onChange={(e) =>
                      setReviewed({
                        ...reviewed,
                        [item.reference]: e.target.checked,
                      })
                    }
                  />
                  Revisei a origem, os créditos e os direitos de uso comercial.
                </label>
                <button
                  className="button primary"
                  disabled={action.busy || !reviewed[item.reference]}
                  onClick={() => void importVideo(item)}
                >
                  Importar e criar cortes
                </button>
              </article>
            ))}
          </div>
          {candidates?.length === 0 && (
            <Empty
              title="Nenhum vídeo autorizado encontrado"
              description="Tente outro tema ou catálogo. Resultados com licenças não aceitas são descartados."
            />
          )}
          <Pagination {...discoveries} onChange={setPage} />
        </>
      )}
    </>
  );
}
