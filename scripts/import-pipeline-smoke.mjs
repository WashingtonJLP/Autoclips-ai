// Whisper/FFmpeg reais. Seleção mock identificada. Nenhuma publicação.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const file = process.argv[2];
assert.ok(file, 'Informe um arquivo de vídeo autorizado com fala.');
const base = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3101';
const headers = {
  Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN}`,
  'Content-Type': 'application/json',
};
async function api(path, body, expected) {
  const response = await fetch(`${base}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  if (expected) assert.equal(response.status, expected, JSON.stringify(data));
  else assert.ok(response.ok, `${path}: ${JSON.stringify(data)}`);
  return data;
}
async function until(fn) {
  for (let i = 0; i < 600; i++) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error('Tempo esgotado aguardando produção automática');
}
async function upload() {
  const query = new URLSearchParams({
    extension: extname(file).slice(1),
    name: basename(file),
    testContent: 'true',
  });
  const response = await fetch(`${base}/media/upload?${query}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/octet-stream' },
    body: readFileSync(file),
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
}
async function finish(task) {
  const production = await until(async () => {
    const lib = await api('library');
    const item = lib.productions.find((p) => p.id === task.id);
    if (!item) return;
    assert.notEqual(item.status, 'FAILED', item.error);
    if (
      item.clips.length &&
      item.clips.every((c) => c.status === 'COMPLETED') &&
      item.steps.every((s) => s.status === 'COMPLETED')
    )
      return item;
  });
  assert.ok(production.steps.some((s) => s.operation === 'transcribe'));
  assert.ok(production.steps.some((s) => s.operation === 'select'));
  const clip = production.clips[0];
  assert.ok(clip.result.video_path);
  assert.ok(clip.result.subtitle_path);
  const transcript = await api(
    `jobs/${production.steps.find((s) => s.operation === 'transcribe').id}`,
  );
  assert.equal(transcript.result.transcription_engine, 'faster-whisper');
  assert.ok(transcript.result.segments.length);
  const selected = await api(
    `jobs/${production.steps.find((s) => s.operation === 'select').id}`,
  );
  assert.ok(
    JSON.stringify(selected.result).includes('mock'),
    'O resultado deve identificar mock',
  );
  for (const [kind, ext] of [
    ['video', 'mp4'],
    ['subtitles', 'srt'],
  ]) {
    const response = await fetch(`${base}/jobs/${clip.id}/artifacts/${kind}`, {
      headers,
    });
    assert.ok(response.ok);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length);
    writeFileSync(`artifacts/refactor-${clip.id}.${ext}`, bytes);
    if (ext === 'srt')
      assert.match(bytes.toString('utf8'), /\d{2}:\d{2}:\d{2},\d{3} -->/);
  }
  const probe = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,codec_name,width,height',
      '-of',
      'json',
      `artifacts/refactor-${clip.id}.mp4`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(probe.status, 0, probe.stderr);
  const streams = JSON.parse(probe.stdout).streams;
  assert.ok(
    streams.some(
      (s) => s.width === 720 && s.height === 1280 && s.codec_name === 'h264',
    ),
  );
  assert.ok(streams.some((s) => s.codec_type === 'audio'));
  return {
    id: task.id,
    clipId: clip.id,
    steps: production.steps,
    streams,
    transcriptionEngine: transcript.result.transcription_engine,
    reusedTranscription: !!transcript.editorial?.reusedTranscriptionId,
    selection: selected.result,
  };
}

mkdirSync('artifacts', { recursive: true });
assert.equal(
  (await api('llm/config')).provider,
  'mock',
  'Teste não permite chamada LLM externa',
);
assert.equal((await fetch(`${base}/jobs`)).status, 401);
assert.equal((await fetch('http://localhost:3100/')).status, 401);
const dashboardHeaders = {
  Authorization: `Basic ${Buffer.from(`${process.env.DASHBOARD_USER}:${process.env.DASHBOARD_PASSWORD}`).toString('base64')}`,
};
for (const page of ['', 'criar', 'biblioteca'])
  assert.equal(
    (
      await fetch(`http://localhost:3100/${page}`, {
        headers: dashboardHeaders,
      })
    ).status,
    200,
  );
const asset = await upload();
assert.equal(
  (await upload()).id,
  asset.id,
  'Upload repetido deve reutilizar asset',
);
const request = {
  assetId: asset.id,
  autoRun: true,
  options: {
    maxClips: 1,
    minDuration: 2,
    maxDuration: 30,
    fallback: 'heuristic',
    minScore: 0,
  },
};
const task = await api('productions', request);
assert.equal(
  (await api('productions', request)).id,
  task.id,
  'Solicitação idêntica deve reutilizar produção',
);
const result = await finish(task);
const imported = (await api('media')).find((a) => a.id === asset.id);
assert.equal(imported.path, asset.path);
const youtube = await api('media/inspect', {
  url: 'https://youtu.be/jNQXAC9IVRw',
});
const variant = await api('media/inspect', {
  url: 'https://youtube.com/shorts/jNQXAC9IVRw',
});
assert.equal(youtube.id, variant.id);
let youtubeDownload = null;
if (process.argv[3]) {
  assert.equal(
    process.env.YOUTUBE_TEST_DOWNLOAD_AUTHORIZED,
    'true',
    'Confirme autorização efetiva para este teste opt-in',
  );
  const authorized = await api('media/inspect', { url: process.argv[3] });
  assert.ok(
    !authorized.path,
    'Arquivo histórico não comprova download direto novo',
  );
  const direct = await api('productions', {
    ...request,
    assetId: authorized.id,
  });
  const initial = await api(`jobs/${direct.id}`);
  assert.equal(initial.payload.engine, 'youtube');
  youtubeDownload = await finish(direct);
}
const evidence = {
  at: new Date().toISOString(),
  uploadAssetId: asset.id,
  duplicateUpload: true,
  duplicateProduction: true,
  libraryVerified: true,
  automaticContinuation: true,
  localPipeline: result,
  youtubeInspection: {
    id: youtube.id,
    platform: youtube.platform,
    imported: !!youtube.path,
  },
  youtubeDownload,
};
writeFileSync(
  'artifacts/refactor-pipeline.json',
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
