// Teste online de um arquivo curto CC0; não publica conteúdo nem chama LLM externo.
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
  for (let i = 0; i < 300; i++) {
    const r = await fn();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error('Tempo esgotado no fluxo por link');
}
assert.equal((await api('llm/config')).provider, 'mock');
const url =
  'https://commons.wikimedia.org/wiki/File:Roy_Cooper_speaks_at_Stop_the_Bans_veto_rally_(video).webm';
const discovery = await api('discovery/multisearch', {
  platforms: ['commons'],
  keywords: 'Roy Cooper speaks',
  maxVideos: 3,
});
assert.equal(discovery.errors.length, 0);
assert.ok(discovery.items.length);
const asset = await api('media/inspect', { url });
assert.equal(asset.metadata.catalog.license, 'CC0');
assert.ok(asset.metadata.catalog.evidence.size < 10000000);
const request = {
  assetId: asset.id,
  confirmCatalogRights: true,
  options: { maxClips: 1, minDuration: 5, maxDuration: 30, language: 'en' },
};
const root = await api('productions', request);
assert.equal((await api('productions', request)).id, root.id);
const chain = await wait(async () => {
  const tasks = await api('jobs');
  const ids = new Set([root.id]);
  for (let i = 0; i < 5; i++)
    for (const t of tasks) {
      if (ids.has(t.parentId)) ids.add(t.id);
      if (ids.has(t.id) && typeof t.result?.reusedTaskId === 'string')
        ids.add(t.result.reusedTaskId);
    }
  const chain = tasks.filter((t) => ids.has(t.id));
  const failure = chain.find((t) => t.status === 'FAILED' || t.error);
  assert.ok(!failure, JSON.stringify(failure));
  return chain.some(
    (t) => t.operation === 'clip' && t.status === 'COMPLETED',
  ) && chain.every((t) => t.status === 'COMPLETED')
    ? chain
    : null;
});
assert.equal(
  (await api('productions', request)).id,
  root.id,
  'Importação já concluída também deve ser reutilizada',
);
const clip = chain.find((t) => t.operation === 'clip');
assert.equal(clip.editorial.simulated, true);
const transcript = chain.find((t) => t.operation === 'transcribe');
assert.ok(transcript.result.segments.length);
const dashboard = {
  Authorization: `Basic ${Buffer.from(`${process.env.DASHBOARD_USER}:${process.env.DASHBOARD_PASSWORD}`).toString('base64')}`,
};
mkdirSync('artifacts', { recursive: true });
for (const kind of ['video', 'subtitles']) {
  const r = await fetch(
    `http://localhost:3100/api/backend/jobs/${clip.id}/artifacts/${kind}`,
    { headers: dashboard },
  );
  assert.equal(r.status, 200);
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.ok(bytes.length > 10);
  writeFileSync(
    `artifacts/link-${clip.id}.${kind === 'video' ? 'mp4' : 'srt'}`,
    bytes,
  );
}
const report = {
  date: new Date().toISOString(),
  url,
  asset: asset.id,
  production: root.id,
  clip: clip.id,
  discoveryCount: discovery.items.length,
  license: 'CC0',
  realDownload: true,
  realWhisper: true,
  segments: transcript.result.segments.length,
  realFFmpeg: true,
  simulatedSelection: true,
  automaticContinuation: true,
  duplicateBeforeAndAfter: true,
  downloadViaDashboard: true,
  paidCalls: 0,
  publications: 0,
};
writeFileSync('artifacts/link-smoke.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
