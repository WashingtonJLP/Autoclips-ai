// Teste HTTP do frontend autenticado e de suas integrações. Não substitui cliques no navegador.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.env.DASHBOARD_URL ?? 'http://127.0.0.1:3100';
const headers = {
  Authorization: `Basic ${Buffer.from(`${process.env.DASHBOARD_USER}:${process.env.DASHBOARD_PASSWORD}`).toString('base64')}`,
  'Content-Type': 'application/json',
};
async function request(path, body, expected = body === undefined ? 200 : 201) {
  const response = await fetch(`${base}/api/backend/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  return data;
}
async function completed(id) {
  for (let i = 0; i < 600; i++) {
    const task = await request(`jobs/${id}`);
    assert.notEqual(task.status, 'FAILED', task.error);
    if (task.status === 'COMPLETED') return task;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Tempo esgotado');
}
const pages = {
  '/': 'Visão geral',
  '/criar': 'Criar cortes',
  '/biblioteca': 'Biblioteca',
  '/publicacoes': 'Publicações',
  '/fontes': 'Fontes',
  '/configuracoes': 'Configurações',
};
for (const [path, heading] of Object.entries(pages)) {
  assert.equal(
    (await fetch(`${base}${path}`)).status,
    401,
    `Proteção de ${path}`,
  );
  const page = await fetch(`${base}${path}`, { headers });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes(heading), `${path}: título ausente`);
  assert.ok(
    html.includes('Navegação principal') &&
      html.includes('Pular para o conteúdo'),
  );
  assert.ok(
    !html.includes('<video'),
    'Nenhuma página deve montar players antes de abrir a prévia',
  );
}
assert.equal((await request('health')).status, 'ok');
assert.equal((await request('ready')).status, 'ok');
const csrf = await fetch(`${base}/api/backend/jobs`, {
  method: 'POST',
  headers: { ...headers, Origin: 'https://evil.invalid' },
  body: '{}',
});
assert.equal(csrf.status, 403);
assert.equal(
  (await fetch(`${base}/api/backend/internal/echo`, { headers })).status,
  404,
);
assert.equal(
  (await request('llm/config')).provider,
  'mock',
  'Este teste bloqueia seleção paga',
);
const discovery = await request('discovery/search', {
  connector: 'commons',
  query: 'flowing water',
});
assert.ok(Array.isArray(discovery));
const source = await request('sources', {
  name: `QA frontend ${new Date().toISOString()}`,
  url: 'https://github.com/WashingtonJLP/Autoclips-ai',
  license: 'PERMISSION',
  evidenceUrl:
    'https://github.com/WashingtonJLP/Autoclips-ai/blob/main/scripts/create-fixture.ps1',
  attribution:
    'Fixture sintética local autorizada: System.Speech e FFmpeg. Teste de regressão do frontend.',
  commercialUseVerified: true,
});
assert.ok((await request('sources')).some((s) => s.id === source.id));
const transcription = await completed(
  (
    await request('jobs', {
      sourceId: source.id,
      operation: 'transcribe',
      path:
        process.env.DASHBOARD_FIXTURE_PATH ??
        'fixtures/e2e-authorized-20261028.mp4',
      autoRun: false,
    })
  ).id,
);
assert.ok(transcription.result.segments.length);
const selection = await completed(
  (await request(`jobs/${transcription.id}/select`, {})).id,
);
assert.ok(selection.result.clips.length);
const body = { candidateId: selection.result.clips[0].id };
const rendering = await request(`jobs/${selection.id}/render-selection`, body);
assert.equal(
  (await request(`jobs/${selection.id}/render-selection`, body)).id,
  rendering.id,
);
const clip = await completed(rendering.id);
for (const kind of ['video', 'subtitles', 'transcript']) {
  const id = kind === 'transcript' ? transcription.id : clip.id;
  const response = await fetch(
    `${base}/api/backend/jobs/${id}/artifacts/${kind}`,
    { headers },
  );
  assert.equal(response.status, 200);
  assert.ok((await response.arrayBuffer()).byteLength > 0);
}
for (const path of [
  `/criar?producao=${transcription.id}`,
  `/criar?fonte=${source.id}`,
  `/biblioteca?aba=trechos`,
  `/biblioteca?video=${clip.id}`,
  `/publicacoes?video=${clip.id}`,
])
  assert.equal((await fetch(`${base}${path}`, { headers })).status, 200);
const scheduledAt = new Date(Date.now() + 2000).toISOString();
const schedule = await request(`jobs/${clip.id}/schedule`, {
  platform: 'youtube',
  scheduledAt,
});
assert.equal(
  (
    await request(`jobs/${clip.id}/schedule`, {
      platform: 'youtube',
      scheduledAt,
    })
  ).id,
  schedule.id,
);
let simulated;
for (let i = 0; i < 60; i++) {
  simulated = (await request('platforms')).publications.find(
    (p) => p.id === schedule.id && p.status === 'SIMULATED',
  );
  if (simulated) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.equal(simulated?.result.published, false);
assert.equal((await request(`jobs/${clip.id}/publish`, {})).published, false);
await request(
  'oauth/callback',
  { platform: 'youtube', state: 'invalid', code: 'invalid' },
  400,
);
await request(
  'jobs',
  { sourceId: source.id, path: '../outside.mp4', operation: 'transcribe' },
  400,
);
const report = {
  date: new Date().toISOString(),
  pages: Object.keys(pages),
  source: source.id,
  transcription: transcription.id,
  selection: selection.id,
  clip: clip.id,
  publication: schedule.id,
  authenticated: true,
  csrfBlocked: true,
  downloads: ['MP4', 'SRT', 'JSON'],
  paidCalls: 0,
  realPublications: 0,
  browserClicksTested: false,
};
mkdirSync('artifacts', { recursive: true });
writeFileSync(
  'artifacts/dashboard-smoke.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
