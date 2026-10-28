'use client';

import { useState } from 'react';
type Candidate = {
  reference: string;
  name: string;
  url: string;
  license: string;
  evidenceUrl: string;
  attribution: string;
};
type Platforms = {
  accounts: { platform: string }[];
  publications: {
    id: string;
    platform: string;
    status: string;
    taskId: string;
    scheduledAt: string;
  }[];
};
const field =
  'rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm';
const button =
  'rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50';
async function api(path: string, body?: unknown) {
  const response = await fetch(`/api/backend/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      typeof value.message === 'string'
        ? value.message
        : 'Confira configuração e autorização',
    );
  return value;
}
export default function Automation({
  onChange,
}: {
  onChange: () => Promise<void>;
}) {
  const [connector, setConnector] = useState('commons');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [platforms, setPlatforms] = useState<Platforms | null>(null);
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha na operação');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-6 space-y-6" aria-label="Automação e plataformas">
      <div className="rounded-2xl border border-slate-800 p-6">
        <h3 className="text-lg">Descobrir vídeos autorizados</h3>
        <p className="my-3 text-sm text-slate-400">
          A busca verifica metadados CC BY 4.0/CC0. Revise direitos de terceiros
          e a atribuição antes de importar. Manifestos aceitam fontes com
          permissão expressa configuradas pelo operador.
        </p>
        <form
          className="flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const query = String(new FormData(e.currentTarget).get('query'));
            void action(async () => {
              setCandidates(
                await api('discovery/search', { connector, query }),
              );
              setReviewed({});
              setMessage(
                'Busca concluída. Resultados com licenças não aceitas são descartados.',
              );
            });
          }}
        >
          <select
            aria-label="Conector"
            className={field}
            value={connector}
            onChange={(e) => {
              setConnector(e.target.value);
              setCandidates([]);
              setReviewed({});
            }}
          >
            <option value="commons">Wikimedia Commons</option>
            <option value="manifest">Catálogo autorizado</option>
          </select>
          <input
            className={field}
            name="query"
            required
            maxLength={200}
            placeholder="Tema do vídeo"
            aria-label="Tema do vídeo"
          />
          <button className={button} disabled={busy}>
            Buscar vídeos
          </button>
        </form>
        <div className="mt-4 space-y-4">
          {candidates.map((item) => (
            <article
              key={item.reference}
              className="rounded-lg border border-slate-700 p-4"
            >
              <h4>
                {item.name} · {item.license}
              </h4>
              <p className="my-2 text-sm text-slate-400">{item.attribution}</p>
              <a
                className="text-sm text-emerald-300"
                href={item.evidenceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Abrir evidência da licença
              </a>
              <label className="my-3 flex gap-3 text-sm">
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
                Revisei os direitos de uso comercial, a origem e os créditos.
              </label>
              <button
                className={button}
                disabled={busy || !reviewed[item.reference]}
                onClick={() =>
                  void action(async () => {
                    const task = await api('discovery/import', {
                      connector,
                      reference: item.reference,
                      commercialUseVerified: true,
                      autoRun: true,
                    });
                    setMessage(
                      `Coleta e fluxo automático enfileirados: ${task.id}. Use Atualizar para acompanhar.`,
                    );
                    await onChange();
                  })
                }
              >
                Importar e produzir automaticamente
              </button>
            </article>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-slate-800 p-6">
        <h3 className="text-lg">Plataformas e agendamentos</h3>
        <p className="my-3 text-sm text-slate-400">
          Publicação permanece em simulação. OAuth requer credenciais do
          aplicativo. TikTok requer aprovação, escopo video.publish e
          consentimento específico para postagem.
        </p>
        <div className="flex flex-wrap gap-3">
          {['youtube', 'tiktok'].map((platform) => (
            <button
              key={platform}
              className={button}
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await api('oauth/start', { platform });
                  window.location.assign(result.url);
                })
              }
            >
              Conectar {platform === 'youtube' ? 'YouTube' : 'TikTok'}
            </button>
          ))}
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              void action(async () => setPlatforms(await api('platforms')))
            }
          >
            Consultar conexões e agendamentos
          </button>
        </div>
        {platforms && (
          <div className="mt-4 text-sm">
            <p>
              Conectadas:{' '}
              {platforms.accounts.map((v) => v.platform).join(', ') ||
                'nenhuma'}
            </p>
            {platforms.publications.map((p) => (
              <p key={p.id} className="mt-2 break-all">
                {p.platform} · {new Date(p.scheduledAt).toLocaleString()} ·{' '}
                {p.status} · tarefa {p.taskId} · publicação real: não
              </p>
            ))}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-950 p-4 text-red-200">
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="rounded-lg bg-emerald-950 p-4 text-emerald-200"
        >
          {message}
        </p>
      )}
    </section>
  );
}
