// Teste local autenticado: não publica nem permite inferência externa/paga.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]])
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const base = 'http://localhost:3100/api/backend/';
const headers = {
  Authorization:
    'Basic ' +
    Buffer.from(
      process.env.DASHBOARD_USER + ':' + process.env.DASHBOARD_PASSWORD,
    ).toString('base64'),
  'Content-Type': 'application/json',
};
async function api(path, body, expected) {
  const r = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const d = await r.json();
  if (expected) assert.equal(r.status, expected, JSON.stringify(d));
  else assert.ok(r.ok, path + ' ' + JSON.stringify(d));
  return d;
}
async function completed(id) {
  for (let i = 0; i < 180; i++) {
    const p = (await api('library')).productions.find((p) => p.id === id);
    assert.ok(p, 'Produção deve aparecer imediatamente');
    assert.notEqual(p.status, 'FAILED', p.error);
    if (
      p.clips.some((t) => t.status === 'COMPLETED') &&
      p.steps.every((s) => s.status === 'COMPLETED')
    )
      return p;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error('Tempo esgotado na produção ' + id);
}
assert.equal(
  (await api('llm/config')).provider,
  'mock',
  'Este roteiro exige mock e nunca altera o provedor',
);
const sourcesBefore = (await api('sources')).map((s) => s.id).sort();
const bytes = readFileSync(
  process.env.CREATION_FIXTURE_PATH ??
    'media/fixtures/creation-own-20261030.mp4',
);
async function upload() {
  const r = await fetch(
    base +
      'media/upload?extension=mp4&name=Minha%20m%C3%ADdia%20sint%C3%A9tica.mp4&testContent=true',
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body: bytes,
    },
  );
  const asset = await r.json();
  assert.ok(r.ok, JSON.stringify(asset));
  return asset;
}
const asset = await upload();
assert.ok(asset.path && asset.sha256);
assert.equal(asset.testContent, true);
assert.equal((await upload()).id, asset.id);
const request = {
  assetId: asset.id,
  options: { maxClips: 1, minDuration: 5, maxDuration: 30, language: 'en' },
};
if (!asset.rightsConfirmed) {
  const challenge = await api('productions', request, 400);
  assert.equal(challenge.code, 'AUTHORIZATION_REQUIRED');
}
const root = await api('productions', { ...request, confirmPermission: true });
const production = await completed(root.id);
assert.equal(production.testContent, true);
assert.equal(production.title, asset.title);
assert.ok(production.steps.some((s) => s.operation === 'transcribe'));
const transcript = await api(
  'jobs/' + production.steps.find((s) => s.operation === 'transcribe').id,
);
assert.equal(transcript.result.transcription_engine, 'faster-whisper');
assert.equal(transcript.result.compute_type, 'int8');
assert.ok(transcript.result.segments.length);
const clip = production.clips.find((t) => t.status === 'COMPLETED');
assert.equal(clip.editorial.selectionOrigin, 'mock');
assert.equal(clip.testContent, true);
mkdirSync('artifacts', { recursive: true });
for (const kind of ['video', 'subtitles']) {
  const r = await fetch(base + `jobs/${clip.id}/artifacts/${kind}`, {
    headers,
  });
  assert.equal(r.status, 200);
  const data = Buffer.from(await r.arrayBuffer());
  assert.ok(data.length > 10);
  writeFileSync(
    `artifacts/creation-library.${kind === 'video' ? 'mp4' : 'srt'}`,
    data,
  );
}
const decoded = spawnSync(
  'ffmpeg',
  ['-v', 'error', '-i', 'artifacts/creation-library.mp4', '-f', 'null', '-'],
  { encoding: 'utf8' },
);
assert.equal(decoded.status, 0, decoded.stderr);
const filesBefore = readdirSync('media/outputs').sort();
const idsBefore = (await api('jobs')).map((t) => t.id).sort();
const duplicate = await Promise.all(
  Array.from({ length: 8 }, () => api('productions', request)),
);
assert.ok(duplicate.every((t) => t.id === root.id));
assert.deepEqual((await api('jobs')).map((t) => t.id).sort(), idsBefore);
assert.deepEqual(readdirSync('media/outputs').sort(), filesBefore);
const version = await api('productions', { ...request, reprocess: true });
assert.notEqual(version.id, root.id);
const newer = await completed(version.id);
assert.notEqual(newer.clips[0].id, clip.id);
const removed = await api(`jobs/${clip.id}/remove`, {});
await api('jobs/' + clip.id, undefined, 404);
assert.equal(
  (await fetch(base + `jobs/${clip.id}/artifacts/video`, { headers })).status,
  404,
);
assert.ok(!(await api('library')).clips.some((t) => t.id === clip.id));
assert.ok((await api('library')).clips.some((t) => t.id === newer.clips[0].id));
await api(`jobs/${clip.id}/restore`, { undoToken: removed.undoToken });
assert.equal((await api('jobs/' + clip.id)).status, 'COMPLETED');
const removedProduction = await api(`jobs/${root.id}/remove`, {});
assert.ok(!(await api('library')).productions.some((p) => p.id === root.id));
await api('jobs/' + clip.id, undefined, 404);
assert.equal((await api('jobs/' + newer.clips[0].id)).status, 'COMPLETED');
await api(`jobs/${root.id}/restore`, {
  undoToken: removedProduction.undoToken,
});
assert.ok((await api('library')).productions.some((p) => p.id === root.id));
assert.equal(
  (await api('productions', request)).id,
  root.id,
  'Desfazer preserva identidade da produção',
);
const youtube = await api('media/inspect', {
  url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
});
assert.equal(youtube.platform, 'youtube');
assert.equal(youtube.accessible, false);
assert.equal(youtube.availability.kind, 'upload_required');
assert.ok(youtube.thumbnailUrl?.startsWith('https://i.ytimg.com/'));
assert.ok(!/API_KEY|cadastre|fonte/i.test(youtube.availability.message));
assert.equal(
  (
    await api(
      'productions',
      { assetId: youtube.id, confirmPermission: true },
      400,
    )
  ).code,
  'ORIGINAL_REQUIRED',
);
const twitch = await api('media/inspect', {
  url: 'https://www.twitch.tv/videos/123456789',
});
assert.equal(twitch.platform, 'twitch');
assert.equal(twitch.availability.kind, 'upload_required');
assert.match(twitch.availability.message, /conexão.*não está configurada/);
const vimeo = await api('media/inspect', { url: 'https://vimeo.com/76979871' });
assert.equal(vimeo.platform, 'vimeo');
assert.equal(vimeo.accessible, false);
const catalog = await api('media/inspect', {
  url: 'https://commons.wikimedia.org/wiki/File:Roy_Cooper_speaks_at_Stop_the_Bans_veto_rally_(video).webm',
});
const directUrl = new URL(catalog.mediaUrl);
directUrl.searchParams.set('creation_test', String(Date.now()));
const direct = await api('media/inspect', { url: directUrl.href });
assert.equal(direct.platform, 'direct');
const directRoot = await api('productions', {
  assetId: direct.id,
  confirmPermission: true,
  options: request.options,
});
const directProduction = await completed(directRoot.id);
assert.ok(directProduction.steps.some((s) => s.operation === 'download'));
const importedLink = await api('media/inspect', { url: directUrl.href });
assert.equal(importedLink.id, direct.id);
assert.equal(importedLink.availability.kind, 'imported');
assert.deepEqual(
  (await api('sources')).map((s) => s.id).sort(),
  sourcesBefore,
  'Permissões internas não viram cadastros de monitoramento',
);
const report = {
  date: new Date().toISOString(),
  asset: asset.id,
  production: root.id,
  clip: clip.id,
  newVersion: version.id,
  directProduction: directRoot.id,
  uploadWithoutSource: true,
  oneTimePermission: true,
  importedById: true,
  immediateLibrary: true,
  realWhisper: true,
  realFFmpeg: true,
  simulatedSelection: true,
  fullDecode: true,
  concurrentDuplicates: 8,
  noExtraTasksOrFiles: true,
  individualRemoval: true,
  productionRemoval: true,
  undo: true,
  otherProductionPreserved: true,
  syntheticSeparated: true,
  youtube: { title: youtube.title, download: false },
  twitch: { limitation: twitch.availability.message },
  vimeo: { title: vimeo.title, download: false },
  paidCalls: 0,
  publications: 0,
  browserInteractions: false,
};
writeFileSync(
  'artifacts/creation-library-smoke.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
