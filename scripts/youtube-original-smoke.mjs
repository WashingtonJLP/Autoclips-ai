// Mídia CC BY 4.0 disponibilizada legalmente fora do YouTube; nenhum extrator.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]])
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const base = 'http://localhost:3100/api/backend/';
const automatic = process.env.YOUTUBE_AUTOMATIC_TEST === 'true';
const artifact = automatic ? 'youtube-automatic' : 'youtube-original';
const requests = [];
const headers = {
  Authorization:
    'Basic ' +
    Buffer.from(
      process.env.DASHBOARD_USER + ':' + process.env.DASHBOARD_PASSWORD,
    ).toString('base64'),
  'Content-Type': 'application/json',
};
async function api(path, body, expected) {
  requests.push(path);
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
const youtubeUrl = automatic
  ? 'https://www.youtube.com/watch?v=D7k9RnSyrUw'
  : 'https://www.youtube.com/watch?v=zZ0gQMnpxxo';
const youtube = await api('media/inspect', { url: youtubeUrl });
assert.equal(youtube.platform, 'youtube');
const evidenceUrl = automatic
  ? youtube.metadata.catalog?.evidenceUrl
  : 'https://commons.wikimedia.org/wiki/File:Julie_Menin_speech_at_2026_Knicks_Championship_Ceremony.webm';
assert.ok(evidenceUrl);
const catalog = automatic
  ? youtube
  : await api('media/inspect', { url: evidenceUrl });
assert.equal(catalog.metadata.catalog.license, 'CC-BY-4.0');
assert.ok(catalog.metadata.catalog.evidence.size < 30000000);
if (automatic) {
  assert.equal(youtube.accessible, true);
  assert.equal(youtube.metadata.acquisition.method, 'commons-youtube');
  assert.equal(youtube.metadata.acquisition.youtubeId, 'D7k9RnSyrUw');
  assert.match(youtube.title, /versão licenciada/);
  if (process.env.YOUTUBE_REQUIRE_FRESH === 'true')
    assert.ok(!youtube.path, 'Exige primeiro download real');
} else if (!youtube.path && !youtube.metadata.authorizedOriginal)
  assert.equal(youtube.availability.kind, 'upload_required');
const linked = automatic
  ? youtube
  : await api(`media/${youtube.id}/original`, {
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
if (automatic && !youtube.path) {
  assert.equal(root.operation, 'download');
  assert.equal(
    root.payload.expected_sha1,
    catalog.metadata.catalog.evidence.sha1,
  );
}
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
  url: 'https://youtu.be/' + youtube.externalId,
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
    `artifacts/${artifact}.` + (kind === 'video' ? 'mp4' : 'srt'),
    data,
  );
}
const decode = spawnSync(
  'ffmpeg',
  ['-v', 'error', '-i', `artifacts/${artifact}.mp4`, '-f', 'null', '-'],
  { encoding: 'utf8' },
);
assert.equal(decode.status, 0, decode.stderr);
const download = production.steps.find((t) => t.operation === 'download');
let matchingLicensedFile = false;
let downloadEngine;
if (download) {
  const t = await api('jobs/' + download.id);
  downloadEngine = t.result.download_engine ?? 'native-or-cache';
  if (automatic && !youtube.path) assert.equal(downloadEngine, 'yt-dlp');
  matchingLicensedFile =
    createHash('sha1')
      .update(readFileSync('media/' + t.result.path))
      .digest('hex') === catalog.metadata.catalog.evidence.sha1;
  assert.equal(matchingLicensedFile, true);
}
if (automatic) {
  assert.ok(
    !requests.some((path) => /\/original$|upload|^sources/.test(path)),
    'Nenhum vínculo, upload ou cadastro manual permitido neste teste',
  );
  const files = () =>
    ['downloads', 'outputs']
      .flatMap((directory) =>
        readdirSync('media/' + directory).map((name) => directory + '/' + name),
      )
      .sort();
  const before = files();
  const variants = [
    'https://youtube.com/shorts/D7k9RnSyrUw',
    'https://www.youtube.com/live/D7k9RnSyrUw',
    'https://www.youtube-nocookie.com/embed/D7k9RnSyrUw',
  ];
  await Promise.all(
    variants.map(async (url) => {
      const reused = await api('media/inspect', { url });
      assert.equal(reused.id, linked.id);
      assert.equal(
        (await api('productions', { ...request, assetId: reused.id })).id,
        root.id,
      );
    }),
  );
  const repeated = (await api('library')).productions.find(
    (p) => p.id === root.id,
  );
  assert.deepEqual(
    repeated.clips.map((c) => c.id).sort(),
    production.clips.map((c) => c.id).sort(),
  );
  assert.deepEqual(
    repeated.steps.map((c) => c.id).sort(),
    production.steps.map((c) => c.id).sort(),
  );
  assert.deepEqual(
    files(),
    before,
    'Repetição por aliases não deve criar arquivos',
  );
}
const probe = spawnSync(
  'ffprobe',
  [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_name,width,height',
    '-of',
    'json',
    `artifacts/${artifact}.mp4`,
  ],
  { encoding: 'utf8' },
);
assert.equal(probe.status, 0, probe.stderr);
const output = JSON.parse(probe.stdout);
const videoDuration = Number(output.format.duration);
const timestamp = (value) => {
  const [h, m, s, ms] = value.split(/[:,]/).map(Number);
  return h * 3600 + m * 60 + s + ms / 1000;
};
const subtitles = [
  ...readFileSync(`artifacts/${artifact}.srt`, 'utf8').matchAll(
    /(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/g,
  ),
];
assert.ok(subtitles.length);
let last = 0;
for (const [, a, b] of subtitles) {
  const start = timestamp(a),
    end = timestamp(b);
  assert.ok(start >= last && end > start && end <= videoDuration + 0.1);
  last = end;
}
const range = await fetch(base + `jobs/${clip.id}/artifacts/video`, {
  headers: { ...headers, Range: 'bytes=0-1023' },
});
assert.equal(range.status, 206);
assert.equal((await range.arrayBuffer()).byteLength, 1024);
const result = {
  date: new Date().toISOString(),
  youtubeUrl,
  evidenceUrl,
  asset: linked.id,
  production: root.id,
  clip: clip.id,
  mediaMethod: automatic ? 'commons-youtube' : 'rights-holder-url',
  actualSource: catalog.metadata.catalog.reference,
  license: catalog.metadata.catalog.license,
  attribution: catalog.metadata.catalog.attribution,
  manualOriginalLink: !automatic,
  manualUpload: false,
  downloadEngine,
  downloadFromYouTube: false,
  realHttpsImport: !youtube.path,
  matchingLicensedFile,
  realWhisper: true,
  whisperComputeType: transcription.result.compute_type,
  transcriptionSegments: transcription.result.segments.length,
  transcriptionTask: transcription.id,
  realFFmpeg: true,
  selection: 'mock',
  quality: clip.result.quality,
  streams: output.streams,
  duration: videoDuration,
  subtitleIntervals: subtitles.length,
  validSubtitleTimestamps: true,
  playerRange206: true,
  duplicateAliasesChecked: automatic,
  automaticCompletion: true,
  reusedShortYoutubeUrl: true,
  mp4AndSrt: true,
  fullDecode: true,
  paidCalls: 0,
  publications: 0,
};
writeFileSync(
  `artifacts/${artifact}-smoke.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
