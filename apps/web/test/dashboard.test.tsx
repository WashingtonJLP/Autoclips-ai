import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesTask } from '../app/shared/models';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  paginate,
  descendants,
  Task,
  title,
  duration,
} from '../app/shared/models';
import ClipCard from '../app/components/clip-card';
import Preview from '../app/components/preview';
import { Pagination, Feedback, Advanced } from '../app/components/ui';
import ProductionForm from '../app/components/production-form';

const task: Task = {
  id: 'interno',
  sourceId: 'fonte',
  operation: 'clip',
  status: 'COMPLETED',
  payload: {},
  result: { start: 1, end: 11, subtitle_path: 'outputs/test.srt' },
  error: null,
  createdAt: '2026-10-28T00:00:00Z',
  editorial: { title: 'Uma boa ideia <script>', description: 'Descrição' },
};
test('paginação limita os cartões, preserva ordem e trata filtros e limites', () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  assert.deepEqual(paginate(items, 2).items, [8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(paginate(items, 99).current, 4);
  assert.deepEqual(paginate([], 4), {
    items: [],
    current: 1,
    pages: 1,
    total: 0,
  });
  assert.equal(paginate(items, -1).items.length, 8);
  const html = renderToStaticMarkup(
    <Pagination {...paginate(items, 1)} onChange={() => {}} />,
  );
  assert.match(html, /aria-label="Paginação"/);
  assert.match(html, /disabled/);
});
test('cadeia de produção segue relações reais sem misturar outras tarefas', () => {
  const tasks = [
    { ...task, id: 'root', operation: 'download' },
    { ...task, id: 't', parentId: 'root', operation: 'transcribe' },
    { ...task, id: 's', parentId: 't', operation: 'select' },
    { ...task, id: 'v', parentId: 's' },
    { ...task, id: 'outro' },
  ];
  assert.deepEqual(
    descendants(tasks, 'root').map((t) => t.id),
    ['root', 't', 's', 'v'],
  );
  assert.equal(title(task), 'Uma boa ideia <script>');
  assert.equal(duration(task), '10,0 s');
});
test('galeria e prévia fechada não montam players nem expõem IDs no texto', () => {
  const html = renderToStaticMarkup(
    <ClipCard task={task} onPreview={() => {}} />,
  );
  assert.ok(!html.includes('<video'));
  assert.ok(!html.includes('interno'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Assistir'));
  const advanced = renderToStaticMarkup(
    <Advanced value={{ id: 'id-interno', result: 'json-pesado' }} />,
  );
  assert.ok(
    !advanced.includes('id-interno') && !advanced.includes('<pre'),
    'JSON deve ser materializado só ao expandir detalhes',
  );
  assert.equal(
    renderToStaticMarkup(<Preview task={null} onClose={() => {}} />),
    '',
  );
});
test('formulário preserva fonte, caminho, modo automático e feedback acessível', () => {
  const source = {
    id: 'fonte',
    name: 'Fonte autorizada',
    url: 'https://example.com',
    license: 'CC0',
    evidenceUrl: 'https://example.com/license',
    attribution: 'Autor',
    commercialUseVerified: true,
    verifiedAt: '2026-10-28T00:00:00Z',
  };
  const html = renderToStaticMarkup(
    <ProductionForm sources={[source]} tasks={[]} onCreated={() => {}} />,
  );
  assert.equal(
    matchesTask(task, [source], 'FONTE AUTORIZADA'),
    true,
    'A origem continua pesquisável mesmo com título editorial diferente',
  );
  assert.equal(matchesTask(task, [source], 'boa ideia'), true);
  assert.equal(matchesTask(task, [source], 'não existe'), false);
  for (const field of [
    'name="sourceId"',
    'name="url"',
    'name="autoRun"',
    'Gerar cortes',
    'Colar link',
    'Escolher vídeo',
    'Enviar arquivo',
  ])
    assert.ok(html.includes(field));
  assert.ok(
    !html.includes('type="file"'),
    'Entrada inicial por link não deve exigir upload',
  );
  const notice = renderToStaticMarkup(
    <Feedback error="Falha" message="Concluído" loading />,
  );
  assert.ok(
    notice.includes('role="alert"') && notice.includes('role="status"'),
  );
});
