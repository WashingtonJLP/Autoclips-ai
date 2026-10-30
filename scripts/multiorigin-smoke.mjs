// Sem chamadas LLM externas ou publicação. Não imprime credenciais.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/);
  if (m && !process.env[m[1]])
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const base = 'http://localhost:3101';
const headers = {
  Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN}`,
  'Content-Type': 'application/json',
};
async function api(path, body, expected = 200) {
  const r = await fetch(`${base}/${path}`, {
    headers,
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await r.json();
  assert.ok(
    r.status === expected || (expected === 200 && r.status === 201),
    `${path}: ${r.status} ${JSON.stringify(data)}`,
  );
  return data;
}
async function wait(fn, label) {
  for (let i = 0; i < 600; i++) {
    const r = await fn();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error(`Timeout: ${label}`);
}
const settings = await api('llm/config');
assert.equal(settings.provider, 'mock');
const source = await api('sources', {
  name: `Teste multiorigem ${new Date().toISOString()}`,
  url: 'https://github.com/WashingtonJLP/Autoclips-ai',
  license: 'PERMISSION',
  evidenceUrl:
    'https://github.com/WashingtonJLP/Autoclips-ai/blob/main/scripts/create-fixture.ps1',
  attribution:
    'Teste sintético autorizado, fala criada localmente e fundo FFmpeg. Sem mídia de terceiros.',
  commercialUseVerified: true,
});
const bytes = readFileSync(
  process.env.MULTIORIGIN_FIXTURE_PATH ??
    'media/fixtures/e2e-authorized-20261028.mp4',
);
const dashboardHeaders = {
  Authorization: `Basic ${Buffer.from(`${process.env.DASHBOARD_USER}:${process.env.DASHBOARD_PASSWORD}`).toString('base64')}`,
  'Content-Type': 'application/octet-stream',
};
async function upload() {
  const r = await fetch(
    `http://localhost:3100/api/backend/media/upload?sourceId=${source.id}&extension=mp4`,
    { method: 'POST', headers: dashboardHeaders, body: bytes },
  );
  const asset = await r.json();
  assert.equal(r.status, 201, JSON.stringify(asset));
  return asset;
}
const asset = await upload();
assert.ok(asset.sha256);
assert.equal((await upload()).id, asset.id);
assert.ok((await api('media')).some((a) => a.id === asset.id));
const request = {
  assetId: asset.id,
  autoRun: true,
  options: { maxClips: 2, minDuration: 5, maxDuration: 60, language: 'en' },
};
const root = await api('productions', request);
assert.equal(
  (await api('productions', request)).id,
  root.id,
  'Produção duplicada deve reutilizar tarefa',
);
const clips = await wait(async () => {
  const tasks = await api('jobs');
  const ids = new Set([root.id]);
  for (let i = 0; i < 4; i++)
    for (const t of tasks) if (ids.has(t.parentId)) ids.add(t.id);
  const chain = tasks.filter((t) => ids.has(t.id));
  const failure = chain.find((t) => t.status === 'FAILED' || t.error);
  assert.ok(!failure, JSON.stringify(failure));
  const clips = chain.filter(
    (t) => t.operation === 'clip' && t.status === 'COMPLETED',
  );
  return clips.length && chain.every((t) => t.status === 'COMPLETED')
    ? clips
    : null;
}, 'Whisper → seleção mock → FFmpeg');
mkdirSync('artifacts', { recursive: true });
for (const clip of clips) {
  assert.equal(clip.editorial.simulated, true);
  for (const kind of ['video', 'subtitles']) {
    const r = await fetch(`${base}/jobs/${clip.id}/artifacts/${kind}`, {
      headers,
    });
    assert.equal(r.status, 200);
    const bytes = Buffer.from(await r.arrayBuffer());
    assert.ok(bytes.length > 10);
    writeFileSync(
      `artifacts/multiorigin-${clip.id}.${kind === 'video' ? 'mp4' : 'srt'}`,
      bytes,
    );
  }
  const probe = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_streams',
      '-of',
      'json',
      `artifacts/multiorigin-${clip.id}.mp4`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(probe.status, 0);
  const streams = JSON.parse(probe.stdout).streams;
  assert.ok(
    streams.some(
      (s) => s.codec_name === 'h264' && s.width === 720 && s.height === 1280,
    ),
  );
  assert.ok(streams.some((s) => s.codec_name === 'aac'));
}
const changed = await api('productions', {
  ...request,
  options: { ...request.options, maxClips: 1 },
});
assert.notEqual(changed.id, root.id);
await api(`jobs/${changed.id}/cancel`, {});
const explicit = await api('productions', { ...request, reprocess: true });
assert.notEqual(explicit.id, root.id);
await api(`jobs/${explicit.id}/cancel`, {});
const blocked = await api('media/inspect', {
  url: 'https://example.org/unauthorized.mp4',
});
assert.equal(blocked.rightsConfirmed, false);
await api('productions', { assetId: blocked.id }, 400);
const automation = await api('automations', {
  name: 'Teste monitoramento sem credenciais',
  kind: 'source',
  intervalMinutes: 360,
  config: { platforms: ['twitch'], keywords: 'tecnologia', channel: '123' },
});
await api(`automations/${automation.id}/run`, {});
const history = await wait(
  async () =>
    (await api('automations'))
      .find((a) => a.id === automation.id)
      ?.runs.find((r) => r.status !== 'PROCESSING'),
  'histórico de busca',
);
assert.ok(history);
await api(`automations/${automation.id}/toggle`, { enabled: false });
const report = {
  date: new Date().toISOString(),
  asset: asset.id,
  production: root.id,
  clips: clips.map((t) => t.id),
  upload: true,
  imported: true,
  duplicate: true,
  differentConfiguration: true,
  explicitReprocess: true,
  unauthorizedBlocked: true,
  realWhisper: true,
  realFFmpeg: true,
  simulatedSelection: true,
  automation: {
    id: automation.id,
    status: history.status,
    error: history.error,
  },
  paidCalls: 0,
  publications: 0,
};
writeFileSync(
  'artifacts/multiorigin-smoke.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
