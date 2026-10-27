import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import SelectionResults from '../app/selection-results';

const result = {
  provider: 'mock',
  model: 'mock-v1',
  simulated: true,
  consumption: [{ usage: null }],
  clips: [
    {
      id: 'test',
      title: 'Título original <script>injetado</script>',
      description: 'Descrição com contexto revisado.',
      start: 2,
      end: 12,
      score: 7.8,
      classification: 'recomendado',
      scores: { hook: 8, context: 7, value: 8, clarity: 8 },
      excerpt: 'Fala original para revisão.',
    },
  ],
};
test('dashboard apresenta critérios, tempos, revisão e custo desconhecido sem inventar zero', () => {
  const html = renderToStaticMarkup(
    <SelectionResults result={result} busy={false} onRender={() => {}} />,
  );
  for (const text of [
    '7.80/10',
    'Gancho',
    'Contexto',
    'Valor',
    'Clareza',
    '2.00s',
    '12.00s',
    'Descrição com contexto',
    'Fala original',
    'Renderizar trecho',
    'não informado',
    'Simulação heurística',
  ])
    assert.ok(html.includes(text), text);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>injetado'));
  assert.ok(!html.includes('0.000000 USD'));
});
test('dashboard distingue consumo zero informado de ausência de dados e mostra seleção vazia', () => {
  const html = renderToStaticMarkup(
    <SelectionResults
      result={{
        ...result,
        clips: [],
        consumption: [
          { usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 } },
        ],
      }}
      busy={true}
      onRender={() => {}}
    />,
  );
  assert.ok(html.includes('0.000000 USD'));
  assert.ok(html.includes('Nenhum trecho passou'));
});
