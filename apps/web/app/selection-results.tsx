'use client';

type Clip = {
  id: string;
  title: string;
  description: string;
  start: number;
  end: number;
  score: number;
  classification: string;
  scores: { hook: number; context: number; value: number; clarity: number };
  excerpt: string;
};
type Consumption = {
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    costMicros?: number;
  } | null;
};
export default function SelectionResults({
  result,
  busy,
  onRender,
}: {
  result: Record<string, unknown>;
  busy: boolean;
  onRender: (id: string) => void;
}) {
  const clips = (Array.isArray(result.clips) ? result.clips : []) as Clip[];
  const calls = (
    Array.isArray(result.consumption) ? result.consumption : []
  ) as Consumption[];
  const total = (key: 'inputTokens' | 'outputTokens' | 'costMicros') =>
    calls.length && calls.every((c) => typeof c.usage?.[key] === 'number')
      ? calls.reduce((n, c) => n + (c.usage?.[key] ?? 0), 0)
      : null;
  const input = total('inputTokens'),
    output = total('outputTokens'),
    cost = total('costMicros');
  return (
    <section aria-label="Trechos selecionados" className="mt-5 space-y-4">
      <details className="advanced">
        <summary>Informações de IA e consumo</summary>
        <p className="text-sm text-slate-400">
          {String(result.provider)} · {String(result.model)} ·{' '}
          {result.simulated
            ? 'Simulação heurística — sem avaliação por LLM real'
            : 'Sugestões de LLM — revisão editorial obrigatória'}
        </p>
        <p className="text-xs text-slate-500">
          Tokens informados: entrada {input ?? 'não informada'}, saída{' '}
          {output ?? 'não informada'}. Custo informado:{' '}
          {cost === null
            ? 'não informado'
            : `${(cost / 1000000).toFixed(6)} USD`}
          .
        </p>
      </details>
      {!clips.length && (
        <p className="text-sm text-slate-400">
          Nenhum trecho passou pelos limites de duração, nota e duplicação.
        </p>
      )}
      {clips.map((clip) => (
        <article
          key={clip.id}
          className="rounded-lg border border-emerald-900 bg-slate-950 p-5"
        >
          <div className="flex flex-wrap justify-between gap-3">
            <h4 className="font-semibold">{clip.title}</h4>
            <span className="text-sm text-emerald-300">
              {clip.score.toFixed(2)}/10 · {clip.classification}
            </span>
          </div>
          <p className="mt-3 text-sm text-slate-300">{clip.description}</p>
          <p className="mt-3 text-sm text-slate-400">
            {clip.start.toFixed(2)}s → {clip.end.toFixed(2)}s ·{' '}
            {(clip.end - clip.start).toFixed(2)} segundos
          </p>
          <details className="advanced">
            <summary>Critérios de seleção</summary>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              {(
                [
                  ['Gancho', clip.scores.hook],
                  ['Contexto', clip.scores.context],
                  ['Valor', clip.scores.value],
                  ['Clareza', clip.scores.clarity],
                ] as const
              ).map(([label, score]) => (
                <div key={label}>
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="mt-1">{score}/10</dd>
                </div>
              ))}
            </dl>
          </details>
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-slate-400">
              Conferir fala original
            </summary>
            <p className="mt-3 text-slate-300">{clip.excerpt}</p>
          </details>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRender(clip.id)}
            className="button primary"
            style={{ marginTop: 20 }}
          >
            Renderizar trecho com legendas
          </button>
        </article>
      ))}
    </section>
  );
}
