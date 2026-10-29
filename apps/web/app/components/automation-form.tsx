'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, useAction, useResources } from '../shared/api';
import { Feedback } from './ui';
import SelectionCriteria from './selection-criteria';
type Automation = {
  id: string;
  name: string;
  enabled: boolean;
  intervalMinutes: number;
  runs: {
    id: string;
    status: string;
    found: number;
    processed: number;
    error?: string;
  }[];
};
type Candidate = {
  id: string;
  title: string;
  url: string;
  platform: string;
  accessible: boolean;
  rightsConfirmed: boolean;
  reason?: string;
};
export default function AutomationForm() {
  const { data, refresh } = useResources(['automations']),
    action = useAction();
  const [candidates, setCandidates] = useState<Candidate[]>([]),
    [errors, setErrors] = useState<string[]>([]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const config = {
      platforms: form.getAll('platforms'),
      keywords: form.get('keywords'),
      ...(form.get('channel') ? { channel: form.get('channel') } : {}),
      categories: String(form.get('categories') ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
      languages: form.get('language') ? [form.get('language')] : [],
      minDuration: Number(form.get('minDuration')) * 60,
      maxDuration: Number(form.get('maxDuration')) * 60,
      maxVideos: Number(form.get('maxVideos')),
      autoProcess: form.get('autoProcess') === 'on',
      catalogRightsConfirmed: form.get('catalogRightsConfirmed') === 'on',
      ...(form.get('recentDays')
        ? { recentDays: Number(form.get('recentDays')) }
        : {}),
      options: {
        maxClips: Number(form.get('maxClips')),
        minDuration: Number(form.get('clipMinDuration')),
        maxDuration: Number(form.get('clipMaxDuration')),
        language: 'auto',
        criteria: form.getAll('criteria'),
        ...(form.get('minScore')
          ? { minScore: Number(form.get('minScore')) }
          : {}),
        ...(form.get('fallback') ? { fallback: form.get('fallback') } : {}),
      },
    };
    await action.run(async () => {
      if (!form.getAll('criteria').length)
        throw new Error('Selecione pelo menos um critério de seleção.');
      if (form.get('save') === 'on') {
        await api('automations', {
          name: form.get('name'),
          kind: form.get('channel') ? 'source' : 'topic',
          intervalMinutes: Number(form.get('intervalMinutes')),
          config,
        });
        await refresh();
      } else {
        const result = await api<{ items: Candidate[]; errors: string[] }>(
          'discovery/multisearch',
          config,
        );
        setCandidates(result.items);
        setErrors(result.errors);
      }
    }, 'Configuração executada. Revise os resultados e as permissões.');
  }
  return (
    <>
      <Feedback error={action.error} message={action.message} />
      <form className="panel" onSubmit={(e) => void submit(e)}>
        <h2>Busca automática e monitoramento</h2>
        <p className="muted">
          Executa no servidor, com fila única. Resultados descobertos exigem
          confirmação dos direitos e acesso autorizado ao original.
        </p>
        <div className="form-grid">
          <label>
            Nome
            <input
              name="name"
              defaultValue="Minha busca"
              required
              maxLength={200}
            />
          </label>
          <label>
            Temas e palavras-chave
            <input
              name="keywords"
              placeholder="tecnologia inteligência artificial"
              required
              maxLength={200}
            />
          </label>
          <label>
            Categorias (separadas por vírgula)
            <input name="categories" maxLength={200} />
          </label>
          <label>
            ID do canal ou URL do feed RSS (opcional)
            <input name="channel" placeholder="YouTube UC… ou ID Twitch" />
          </label>
          <label>
            Idioma
            <select name="language">
              <option value="">Todos / desconhecido</option>
              <option value="pt">Português</option>
              <option value="en">Inglês</option>
              <option value="es">Espanhol</option>
            </select>
          </label>
          <label>
            Duração mínima (min)
            <input
              name="minDuration"
              type="number"
              min="0"
              max="120"
              defaultValue="0"
              required
            />
          </label>
          <label>
            Duração máxima (min)
            <input
              name="maxDuration"
              type="number"
              min="1"
              max="120"
              defaultValue="120"
              required
            />
          </label>
          <label>
            Máximo de vídeos
            <input
              name="maxVideos"
              type="number"
              min="1"
              max="10"
              defaultValue="5"
              required
            />
          </label>
          <label>
            Máximo de cortes por vídeo
            <input
              name="maxClips"
              type="number"
              min="1"
              max="10"
              defaultValue="3"
              required
            />
          </label>
          <label>
            Duração mínima do corte (s)
            <input
              name="clipMinDuration"
              type="number"
              min="1"
              max="60"
              defaultValue="5"
              required
            />
          </label>
          <label>
            Duração máxima do corte (s)
            <input
              name="clipMaxDuration"
              type="number"
              min="1"
              max="180"
              defaultValue="60"
              required
            />
          </label>
          <label>
            Publicado nos últimos dias
            <input name="recentDays" type="number" min="1" max="365" />
          </label>
          <label>
            Verificar a cada (min)
            <input
              name="intervalMinutes"
              type="number"
              min="60"
              max="43200"
              defaultValue="360"
              required
            />
          </label>
        </div>
        <SelectionCriteria />
        <div className="row">
          {[
            ['youtube', 'YouTube'],
            ['twitch', 'Twitch'],
            ['commons', 'Wikimedia'],
            ['manifest', 'Catálogo autorizado'],
            ['rss', 'RSS / podcasts'],
          ].map(([value, label]) => (
            <label key={value} className="check-label">
              <input
                name="platforms"
                type="checkbox"
                value={value}
                defaultChecked={value === 'commons'}
              />
              {label}
            </label>
          ))}
        </div>
        <label className="check-label">
          <input name="autoProcess" type="checkbox" />
          Processar automaticamente somente vídeos com direitos já confirmados
        </label>
        <label className="check-label">
          <input name="catalogRightsConfirmed" type="checkbox" />
          Confirmo os direitos e a política de reutilização dos catálogos
          selecionados para importação automática (CC0, CC BY 4.0 ou permissão
          expressa). Reverei direitos de terceiros; monetização não é garantida.
        </label>
        <label className="check-label">
          <input name="save" type="checkbox" />
          Salvar e agendar esta busca no servidor
        </label>
        <button className="button primary" disabled={action.busy}>
          Executar / salvar busca
        </button>
      </form>
      {errors.map((e) => (
        <p role="alert" key={e}>
          {e}
        </p>
      ))}
      <div className="source-grid">
        {candidates.map((c) => (
          <article className="source-card" key={c.id}>
            <span className="badge">
              {c.platform} ·{' '}
              {c.rightsConfirmed
                ? 'Direitos confirmados'
                : 'Aguardando autorização'}{' '}
              · {c.accessible ? 'Arquivo acessível' : 'Original necessário'}
            </span>
            <h3>{c.title}</h3>
            <Link className="button" href={`/criar?midia=${c.id}`}>
              Revisar e gerar cortes
            </Link>
            <p>{c.reason}</p>
            <a
              className="text-link"
              href={c.url}
              target="_blank"
              rel="noreferrer"
            >
              Consultar origem
            </a>
          </article>
        ))}
      </div>
      {((data.automations ?? []) as Automation[]).map((a) => (
        <article className="panel" key={a.id}>
          <h3>{a.name}</h3>
          <p>
            {a.enabled ? 'Monitorando' : 'Pausada'} · a cada {a.intervalMinutes}{' '}
            minutos
          </p>
          <button
            className="button"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await api(`automations/${a.id}/toggle`, {
                  enabled: !a.enabled,
                });
                await refresh();
              }, 'Monitoramento atualizado.')
            }
          >
            {a.enabled ? 'Pausar' : 'Retomar'}
          </button>
          <button
            className="button"
            disabled={action.busy || !a.enabled}
            onClick={() =>
              void action.run(
                () => api(`automations/${a.id}/run`, {}),
                'Busca enfileirada. Atualize para consultar o histórico.',
              )
            }
          >
            Verificar agora
          </button>
          {a.runs.map((r) => (
            <p key={r.id}>
              {r.status} · {r.found} encontrados · {r.processed} elegíveis
              processados {r.error && <span role="alert">{r.error}</span>}
            </p>
          ))}
        </article>
      ))}
    </>
  );
}
