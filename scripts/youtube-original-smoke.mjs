// Mídia CC BY 4.0 disponibilizada legalmente fora do YouTube; nenhum extrator.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
    headers,
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const d = await r.json();
  if (expected) assert.equal(r.status, expected, JSON.stringify(d));
  else assert.ok(r.ok, path + ' ' + JSON.stringify(d));
  return d;
}
assert.equal(
  (await api('llm/config')).provider,
  'mock',
  'Roteiro sem consumo externo: selecione mock temporário',
);
const youtubeUrl = 'https://www.youtube.com/watch?v=zZ0gQMnpxxo';
const evidenceUrl =
  'https://commons.wikimedia.org/wiki/File:Julie_Menin_speech_at_2026_Knicks_Championship_Ceremony.webm';
const catalog = await api('media/inspect', { url: evidenceUrl });
assert.equal(catalog.metadata.catalog.license, 'CC-BY-4.0');
assert.ok(catalog.metadata.catalog.evidence.size < 30000000);
const youtube = await api('media/inspect', { url: youtubeUrl });
assert.equal(youtube.platform, 'youtube');
if (!youtube.path && !youtube.metadata.authorizedOriginal)
  assert.equal(youtube.availability.kind, 'upload_required');
const linked = await api(`media/${youtube.id}/original`, {
  mediaUrl: catalog.mediaUrl,
  confirmPermission: true,
  evidenceUrl,
  attribution:
    catalog.metadata.catalog.attribution +
    ' Versão licenciada: excerto de aproximadamente 49 segundos, com fala de Julie Menin. Não é a íntegra da transmissão no YouTube.',
});
assert.equal(linked.platform, 'youtube');
assert.ok(['available', 'imported'].includes(linked.availability.kind));
const request = {
  assetId: linked.id,
  options: { maxClips: 1, minDuration: 5, maxDuration: 30, language: 'en' },
};
const root = await api('productions', request);
assert.equal((await api('productions', request)).id, root.id);
let production;
for (let i = 0; i < 300; i++) {
  production = (await api('library')).productions.find((p) => p.id === root.id);
  assert.ok(production);
  assert.notEqual(production.status, 'FAILED', production.error);
  if (
    production.status === 'COMPLETED' &&
    production.clips.some((t) => t.status === 'COMPLETED')
  )
    break;
  await new Promise((r) => setTimeout(r, 1000));
}
const clip = production.clips.find((t) => t.status === 'COMPLETED');
assert.ok(clip, 'MP4 final ausente');
assert.equal(clip.editorial.selectionOrigin, 'mock');
assert.equal(clip.result.quality.validated, true);
const transcription = await api(
  'jobs/' + production.steps.find((t) => t.operation === 'transcribe').id,
);
assert.equal(transcription.result.transcription_engine, 'faster-whisper');
assert.ok(transcription.result.segments.length);
const imported = await api('media/inspect', {
  url: 'https://youtu.be/zZ0gQMnpxxo',
});
assert.equal(imported.id, linked.id);
assert.equal(imported.availability.kind, 'imported');
assert.ok(imported.path);
mkdirSync('artifacts', { recursive: true });
for (const kind of ['video', 'subtitles']) {
  const r = await fetch(base + `jobs/${clip.id}/artifacts/${kind}`, {
    headers,
  });
  assert.equal(r.status, 200);
  const data = Buffer.from(await r.arrayBuffer());
  assert.ok(data.length > 10);
  writeFileSync(
    'artifacts/youtube-original.' + (kind === 'video' ? 'mp4' : 'srt'),
    data,
  );
}
const decode = spawnSync(
  'ffmpeg',
  ['-v', 'error', '-i', 'artifacts/youtube-original.mp4', '-f', 'null', '-'],
  { encoding: 'utf8' },
);
assert.equal(decode.status, 0, decode.stderr);
const download = production.steps.find((t) => t.operation === 'download');
let matchingLicensedFile = false;
if (download) {
  const t = await api('jobs/' + download.id);
  matchingLicensedFile =
    createHash('sha1')
      .update(readFileSync('media/' + t.result.path))
      .digest('hex') === catalog.metadata.catalog.evidence.sha1;
  assert.equal(matchingLicensedFile, true);
}
const result = {
  date: new Date().toISOString(),
  youtubeUrl,
  evidenceUrl,
  asset: linked.id,
  production: root.id,
  clip: clip.id,
  mediaMethod: 'rights-holder-url',
  actualSource:
    'Wikimedia Commons: versão/excerto CC BY 4.0 de 49 segundos, conforme página de licença',
  downloadFromYouTube: false,
  realHttpsImport: !youtube.path,
  matchingLicensedFile,
  realWhisper: true,
  realFFmpeg: true,
  selection: 'mock',
  quality: clip.result.quality,
  automaticCompletion: true,
  reusedShortYoutubeUrl: true,
  mp4AndSrt: true,
  fullDecode: true,
  paidCalls: 0,
  publications: 0,
};
writeFileSync(
  'artifacts/youtube-original-smoke.json',
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
