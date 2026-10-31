// Teste HTTPS licenciado, sem chamadas LLM externas nem publicação.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
async function api(path, body) {
  const response = await fetch(base + path, {
    headers,
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  assert.ok(response.ok, path + ' ' + JSON.stringify(data));
  return data;
}
assert.equal(
  (await api('llm/config')).provider,
  'mock',
  'Use override temporário mock antes do teste',
);
const page =
  'https://commons.wikimedia.org/wiki/File:Julie_Menin_speech_at_2026_Knicks_Championship_Ceremony.webm';
const catalog = await api('media/inspect', { url: page });
const license = catalog.metadata.catalog;
assert.equal(license.license, 'CC-BY-4.0');
const url = new URL(catalog.mediaUrl);
url.searchParams.set('autoclips_import_test', String(Date.now()));
const asset = await api('media/inspect', { url: url.href });
assert.equal(asset.platform, 'direct');
assert.ok(!asset.path, 'O teste precisa de um download novo');
const request = {
  assetId: asset.id,
  authorization: {
    license: license.license,
    evidenceUrl: license.evidenceUrl,
    attribution: license.attribution,
    commercialUseVerified: true,
  },
  options: { maxClips: 1, minDuration: 6, maxDuration: 27, language: 'en' },
};
const root = await api('productions', request);
assert.equal(root.operation, 'download');
assert.equal(
  root.payload.engine,
  process.env.EXPECT_DOWNLOAD_ENGINE ?? 'yt-dlp',
);
assert.equal((await api('productions', request)).id, root.id);
let production;
for (let i = 0; i < 300; i++) {
  production = (await api('library')).productions.find((p) => p.id === root.id);
  assert.ok(production, 'Produção ausente na Biblioteca');
  assert.notEqual(production.status, 'FAILED', production.error);
  if (
    production.status === 'COMPLETED' &&
    production.clips.some((c) => c.status === 'COMPLETED')
  )
    break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
const finished = await api('jobs/' + root.id);
assert.equal(
  finished.result.download_engine,
  process.env.EXPECT_DOWNLOAD_ENGINE ?? 'yt-dlp',
);
assert.equal(
  createHash('sha1')
    .update(readFileSync('media/' + finished.result.path))
    .digest('hex'),
  license.evidence.sha1,
);
const transcript = await api(
  'jobs/' + production.steps.find((t) => t.operation === 'transcribe').id,
);
assert.equal(transcript.result.transcription_engine, 'faster-whisper');
assert.equal(transcript.result.compute_type, 'int8');
assert.ok(transcript.result.segments.length);
const clip = production.clips.find((c) => c.status === 'COMPLETED');
assert.ok(clip, 'MP4 final ausente');
assert.equal(clip.editorial.selectionOrigin, 'mock');
assert.equal(clip.result.quality.validated, true);
mkdirSync('artifacts', { recursive: true });
for (const [kind, extension] of [
  ['video', 'mp4'],
  ['subtitles', 'srt'],
]) {
  const response = await fetch(base + `jobs/${clip.id}/artifacts/${kind}`, {
    headers,
  });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length > 10);
  writeFileSync('artifacts/url-import-smoke.' + extension, bytes);
}
const decoded = spawnSync(
  'ffmpeg',
  ['-v', 'error', '-i', 'artifacts/url-import-smoke.mp4', '-f', 'null', '-'],
  { encoding: 'utf8' },
);
assert.equal(decoded.status, 0, decoded.stderr);
const probe = spawnSync(
  'ffprobe',
  [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    'artifacts/url-import-smoke.mp4',
  ],
  { encoding: 'utf8' },
);
assert.equal(probe.status, 0, probe.stderr);
const duration = Number(JSON.parse(probe.stdout).format.duration);
assert.ok(duration >= 6 && duration <= 27.2);
const toSeconds = (timestamp) => {
  const [h, m, s, ms] = timestamp.split(/[:,]/).map(Number);
  return h * 3600 + m * 60 + s + ms / 1000;
};
const intervals = [
  ...readFileSync('artifacts/url-import-smoke.srt', 'utf8').matchAll(
    /(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/g,
  ),
];
assert.ok(intervals.length);
let previous = 0;
for (const [, a, b] of intervals) {
  const start = toSeconds(a),
    end = toSeconds(b);
  assert.ok(start >= previous && end > start && end <= duration + 0.1);
  previous = end;
}
const range = await fetch(base + `jobs/${clip.id}/artifacts/video`, {
  headers: { ...headers, Range: 'bytes=0-1023' },
});
assert.equal(range.status, 206);
assert.equal((await range.arrayBuffer()).byteLength, 1024);
const reused = await api('media/inspect', { url: url.href });
assert.equal(reused.id, asset.id);
assert.equal(reused.availability.kind, 'imported');
assert.equal((await api('productions', request)).id, root.id);
const report = {
  date: new Date().toISOString(),
  licensedPage: page,
  license: license.license,
  attribution: license.attribution,
  asset: asset.id,
  production: root.id,
  clip: clip.id,
  downloadEngine: finished.result.download_engine,
  matchingLicensedSha1: true,
  realWhisper: true,
  realFFmpeg: true,
  selection: 'mock',
  automaticCompletion: true,
  duration,
  subtitleIntervals: intervals.length,
  subtitleTimestampsValid: true,
  fullDecode: true,
  mp4AndSrt: true,
  playerRange206: true,
  cachedAssetReused: true,
  equivalentProductionReused: true,
  paidCalls: 0,
  publications: 0,
  visualInspection: false,
};
writeFileSync(
  'artifacts/url-import-smoke.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
