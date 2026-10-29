// Monitoramento de fonte e busca temática executados pelo servidor BullMQ.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/);
  if (m && !process.env[m[1]])
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const headers = {
  Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN}`,
  'Content-Type': 'application/json',
};
async function api(path, body) {
  const r = await fetch(`http://localhost:3101/${path}`, {
    headers,
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json();
  assert.ok(r.ok, JSON.stringify(d));
  return d;
}
async function wait(fn) {
  for (let i = 0; i < 180; i++) {
    const r = await fn();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error('Tempo esgotado na automação');
}
assert.equal((await api('llm/config')).provider, 'mock');
const source = await api('sources', {
  name: `Teste cadastro monitorado ${Date.now()}`,
  url: 'https://www.twitch.tv/teste',
  license: 'PERMISSION',
  evidenceUrl: 'https://example.org/permission',
  attribution: 'Configuração de teste sem mídia importada',
  commercialUseVerified: true,
  monitoring: {
    enabled: false,
    intervalMinutes: 360,
    config: { platforms: ['twitch'], keywords: 'tecnologia', channel: '123' },
  },
});
const monitor = (await api('automations')).find(
  (a) => a.config.sourceId === source.id,
);
assert.ok(monitor);
assert.equal(monitor.enabled, false);
await api(`automations/${monitor.id}/toggle`, { enabled: true });
await api(`automations/${monitor.id}/run`, {});
const blocked = await wait(async () =>
  (await api('automations'))
    .find((a) => a.id === monitor.id)
    .runs.find((r) => r.status !== 'PROCESSING'),
);
assert.match(blocked.error, /TWITCH_CLIENT_ID/);
await api(`automations/${monitor.id}/toggle`, { enabled: false });
const before = new Set((await api('jobs')).map((t) => t.id));
const asset = (await api('media')).find(
  (a) =>
    a.platform === 'commons' &&
    a.externalId ===
      'File:Roy Cooper speaks at Stop the Bans veto rally (video).webm',
);
assert.ok(
  asset?.sourceId,
  'Execute link-smoke.mjs antes do teste de automação',
);
const topic = await api('automations', {
  name: `Teste temas elegíveis ${Date.now()}`,
  kind: 'topic',
  intervalMinutes: 360,
  config: {
    platforms: ['commons'],
    keywords: 'Roy Cooper speaks',
    maxVideos: 1,
    autoProcess: true,
    options: { maxClips: 1, minDuration: 5, maxDuration: 25, language: 'en' },
  },
});
await api(`automations/${topic.id}/run`, {});
const run = await wait(async () =>
  (await api('automations'))
    .find((a) => a.id === topic.id)
    .runs.find((r) => r.status === 'COMPLETED' && r.processed === 1),
);
const clip = await wait(async () => {
  const all = await api('jobs');
  const root = all.find(
    (t) =>
      t.editorial?.assetId === asset.id &&
      t.editorial?.options?.maxDuration === 25,
  );
  if (!root) return null;
  const ids = new Set([root.id]);
  for (let i = 0; i < 4; i++)
    for (const t of all) if (ids.has(t.parentId)) ids.add(t.id);
  const tasks = all.filter((t) => ids.has(t.id));
  const failure = tasks.find((t) => t.status === 'FAILED' || t.error);
  assert.ok(!failure, JSON.stringify(failure));
  return tasks.find((t) => t.operation === 'clip' && t.status === 'COMPLETED');
});
await api(`automations/${topic.id}/toggle`, { enabled: false });
const after = (await api('jobs')).filter(
  (t) => !before.has(t.id) && t.operation === 'clip',
);
assert.ok(
  after.length <= 1,
  'Execuções concorrentes devem reaproveitar a produção',
);
const report = {
  date: new Date().toISOString(),
  source: source.id,
  monitor: monitor.id,
  monitorError: blocked.error,
  topic: topic.id,
  run: run.id,
  processed: run.processed,
  clip: clip.id,
  automaticEligibleProcessing: true,
  reusedExistingProduction: before.has(clip.id),
  pausedAfterTest: true,
  simulatedSelection: true,
  paidCalls: 0,
  publications: 0,
};
mkdirSync('artifacts', { recursive: true });
writeFileSync(
  'artifacts/automation-smoke.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
