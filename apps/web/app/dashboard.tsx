'use client';

import { useCallback, useEffect, useState } from 'react';
import SelectionResults from './selection-results';

type Source = { id: string; name: string; license: string };
type Task = {
  id: string;
  operation: string;
  status: string;
  error: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
  editorial?: { title: string; description: string } | null;
};
type LlmSettings = {
  provider: string;
  model: string;
  simulated: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
  dailyTokenBudget: number;
  dailyCostMicros: number;
  budget: { committedTokens: string; committedCostMicros: string; day: string };
};
const field =
  'mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100';
const button =
  'rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50';

async function api(path: string, body?: unknown) {
  const response = await fetch(`/api/backend/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.message === 'string'
        ? data.message
        : 'Confira os campos e a autorização comercial.',
    );
  return data;
}

export default function Dashboard() {
  const [sources, setSources] = useState<Source[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState('transcribe');
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const refresh = useCallback(async () => {
    try {
      const [nextSources, nextTasks, settings] = await Promise.all([
        api('sources'),
        api('jobs'),
        api('llm/config'),
      ]);
      setSources(nextSources);
      setTasks(nextTasks);
      setLlm(settings);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar');
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function taskAction(path: string, body: unknown, message: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const task = await api(path, body);
      setMessage(`${message} Tarefa: ${task.id}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na tarefa');
    } finally {
      setBusy(false);
    }
  }
  async function submit(
    event: React.FormEvent<HTMLFormElement>,
    kind: 'sources' | 'jobs',
  ) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const body: Record<string, unknown> = Object.fromEntries(
        values.entries(),
      );
      if (kind === 'sources')
        body.commercialUseVerified =
          values.get('commercialUseVerified') === 'on';
      else if (operation === 'clip') {
        body.start = Number(values.get('start'));
        body.end = Number(values.get('end'));
        const segments = String(values.get('segments') ?? '').trim();
        delete body.segments;
        if (segments) body.segments = JSON.parse(segments);
        body.burn_subtitles = values.get('burn_subtitles') === 'on';
      }
      await api(kind, body);
      setMessage(
        kind === 'sources'
          ? 'Fonte cadastrada com evidência de direitos.'
          : 'Tarefa enfileirada. Acompanhe o resultado abaixo.',
      );
      if (kind === 'sources') form.reset();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na operação');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-12" aria-label="Gerenciamento de produção">
      <h2 className="text-2xl font-semibold">Gerenciar produção</h2>
      <p className="mt-3 text-sm text-slate-400">
        Coloque a mídia autorizada na pasta media. Cadastre a fonte e envie o
        caminho relativo para processar.
      </p>
      {llm && (
        <aside className="mt-5 rounded-xl border border-slate-800 p-4 text-sm text-slate-400">
          <p>
            Seleção:{' '}
            <strong className="text-emerald-300">
              {llm.simulated ? 'Simulada, sem API externa' : llm.provider}
            </strong>{' '}
            · modelo {llm.model}
          </p>
          <p className="mt-2">
            Limite por chamada: {llm.maxInputTokens} tokens de entrada /{' '}
            {llm.maxOutputTokens} de saída. Orçamento UTC {llm.budget.day}:{' '}
            {llm.budget.committedTokens}/{llm.dailyTokenBudget} tokens
            comprometidos;{' '}
            {(Number(llm.budget.committedCostMicros) / 1000000).toFixed(6)}/
            {(llm.dailyCostMicros / 1000000).toFixed(6)} USD.
          </p>
          <p className="mt-2 text-xs">
            Reservas incluem consumo ainda desconhecido. Pontuações e textos
            precisam de revisão antes de renderizar.
          </p>
        </aside>
      )}
      {error && (
        <p role="alert" className="mt-5 rounded-lg bg-red-950 p-4 text-red-200">
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="mt-5 rounded-lg bg-emerald-950 p-4 text-emerald-200"
        >
          {message}
        </p>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <form
          onSubmit={(event) => void submit(event, 'sources')}
          className="space-y-4 rounded-2xl border border-slate-800 p-6"
        >
          <h3 className="text-lg">1. Cadastrar fonte</h3>
          <label className="block text-sm">
            Nome
            <input name="name" required maxLength={200} className={field} />
          </label>
          <label className="block text-sm">
            URL de origem
            <input name="url" type="url" required className={field} />
          </label>
          <label className="block text-sm">
            Licença
            <select name="license" className={field}>
              <option value="CC0">CC0</option>
              <option value="CC-BY-4.0">CC BY 4.0</option>
              <option value="PERMISSION">Permissão expressa</option>
            </select>
          </label>
          <label className="block text-sm">
            URL da evidência
            <input name="evidenceUrl" type="url" required className={field} />
          </label>
          <label className="block text-sm">
            Créditos e atribuição
            <textarea
              name="attribution"
              required
              maxLength={2000}
              className={field}
            />
          </label>
          <label className="flex items-start gap-3 text-sm text-slate-300">
            <input
              name="commercialUseVerified"
              type="checkbox"
              required
              className="mt-1"
            />
            Revisei a origem e confirmei a autorização de reutilização comercial
            desta mídia.
          </label>
          <button disabled={busy} className={button}>
            Salvar fonte
          </button>
        </form>
        <form
          onSubmit={(event) => void submit(event, 'jobs')}
          className="space-y-4 rounded-2xl border border-slate-800 p-6"
        >
          <h3 className="text-lg">2. Processar mídia</h3>
          <label className="block text-sm">
            Fonte autorizada
            <select name="sourceId" required defaultValue="" className={field}>
              <option value="" disabled>
                Selecione uma fonte
              </option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name} · {source.license}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Caminho relativo
            <input
              name="path"
              placeholder="fixtures/sample.mp4"
              required
              className={field}
            />
          </label>
          <label className="block text-sm">
            Operação
            <select
              name="operation"
              value={operation}
              onChange={(event) => setOperation(event.target.value)}
              className={field}
            >
              <option value="transcribe">Transcrever</option>
              <option value="clip">Gerar corte vertical</option>
            </select>
          </label>
          {operation === 'clip' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  Início (segundos)
                  <input
                    name="start"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    className={field}
                  />
                </label>
                <label className="text-sm">
                  Fim (segundos)
                  <input
                    name="end"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    className={field}
                  />
                </label>
              </div>
              <label className="block text-sm">
                Segmentos de legenda (JSON, opcional)
                <textarea
                  name="segments"
                  placeholder={
                    '[{"start":0,"end":3,"text":"Legenda revisada"}]'
                  }
                  className={field}
                />
              </label>
              <label className="flex gap-3 text-sm">
                <input name="burn_subtitles" type="checkbox" />
                Inserir legendas no vídeo
              </label>
            </>
          )}
          <button disabled={busy || !sources.length} className={button}>
            Enfileirar tarefa
          </button>
          <p className="text-xs text-slate-500">
            CPU · uma tarefa por vez. Cortes de até 180 segundos.
          </p>
        </form>
      </div>
      <div className="mt-8 flex items-center justify-between">
        <h3 className="text-lg">Tarefas recentes ({tasks.length})</h3>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-sm text-emerald-400"
        >
          Atualizar
        </button>
      </div>
      {!tasks.length ? (
        <p className="mt-5 rounded-lg border border-slate-800 p-6 text-slate-400">
          Nenhuma tarefa cadastrada.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {tasks.map((task) => (
            <article
              key={task.id}
              className="rounded-xl border border-slate-800 p-5"
            >
              <div className="flex flex-wrap justify-between gap-3">
                <strong>
                  {task.operation === 'select'
                    ? 'Seleção de trechos'
                    : task.operation === 'clip'
                      ? 'Corte vertical'
                      : 'Transcrição'}
                </strong>
                <span className="text-sm text-emerald-300">
                  {(
                    {
                      QUEUED: 'Na fila',
                      PROCESSING: 'Processando',
                      RETRYING: 'Aguardando nova tentativa',
                      COMPLETED: 'Concluída',
                      FAILED: 'Falhou',
                    } as Record<string, string>
                  )[task.status] ?? task.status}
                </span>
              </div>
              <p className="mt-2 break-all text-xs text-slate-500">{task.id}</p>
              {task.error && (
                <p className="mt-3 text-sm text-red-300">{task.error}</p>
              )}
              {task.editorial && (
                <div className="mt-4">
                  <h4 className="font-semibold">{task.editorial.title}</h4>
                  <p className="mt-2 text-sm text-slate-400">
                    {task.editorial.description}
                  </p>
                </div>
              )}
              {task.operation === 'select' &&
                task.status === 'COMPLETED' &&
                task.result && (
                  <SelectionResults
                    result={task.result}
                    busy={busy}
                    onRender={(candidateId) =>
                      void taskAction(
                        `jobs/${task.id}/render-selection`,
                        { candidateId },
                        'Renderização solicitada. Repetições reutilizam o mesmo corte.',
                      )
                    }
                  />
                )}
              {task.operation === 'transcribe' &&
                task.status === 'COMPLETED' && (
                  <button
                    type="button"
                    disabled={busy || !llm}
                    onClick={() =>
                      void taskAction(
                        `jobs/${task.id}/select`,
                        {},
                        'Seleção enfileirada.',
                      )
                    }
                    className="mt-5 mr-5 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
                  >
                    Selecionar trechos {llm?.simulated ? '(simulado)' : ''}
                  </button>
                )}
              {task.result && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-emerald-400">
                    Ver resultado e caminhos de saída
                  </summary>
                  <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs">
                    {JSON.stringify(task.result, null, 2)}
                  </pre>
                </details>
              )}
              {task.status === 'COMPLETED' && task.operation === 'clip' && (
                <button
                  type="button"
                  className="mt-4 text-sm text-amber-300"
                  onClick={() => {
                    void api(`jobs/${task.id}/publish`, {})
                      .then(() =>
                        setMessage(
                          'Simulação concluída. Nenhum vídeo foi publicado.',
                        ),
                      )
                      .catch(() => setError('Falha na simulação.'));
                  }}
                >
                  Simular publicação
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
