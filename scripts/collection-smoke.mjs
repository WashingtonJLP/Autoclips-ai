// Executar somente depois de revisar a licença/evidência da referência informada.
// A confirmação é obrigatória; IA só em mock e nenhuma publicação é executada.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const reference = process.argv[2];
assert.ok(
  reference && process.argv.includes('--reviewed'),
  'Informe a referência Commons e --reviewed após revisar direitos e evidência',
);
const base = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3003';
const headers = {
  Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN ?? ''}`,
  'Content-Type': 'application/json',
};
async function api(path, body) {
  const response = await fetch(`${base}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value));
  return value;
}
async function wait(fn) {
  for (let i = 0; i < 600; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Tempo esgotado');
}
async function completed(id) {
  return wait(async () => {
    const task = await api(`jobs/${id}`);
    assert.notEqual(task.status, 'FAILED', task.error);
    assert.equal(task.error, null, task.error);
    return task.status === 'COMPLETED' ? task : null;
  });
}
async function child(parentId, operation) {
  return wait(async () =>
    (await api('jobs')).find(
      (t) => t.parentId === parentId && t.operation === operation,
    ),
  );
}
assert.equal((await api('llm/config')).provider, 'mock');
const body = {
  connector: 'commons',
  reference,
  commercialUseVerified: true,
  autoRun: true,
};
const initial = await api('discovery/import', body);
assert.equal((await api('discovery/import', body)).id, initial.id);
const downloaded = await completed(initial.id);
assert.match(downloaded.result.sha256, /^[a-f0-9]{64}$/);
const source = (await api('sources')).find((s) => s.id === initial.sourceId);
assert.ok(source.evidence.sha1 && source.verifiedAt && source.mediaUrl);
const transcription = await completed(
  (await child(initial.id, 'transcribe')).id,
);
assert.ok(
  transcription.result.segments.length,
  'A mídia revisada deve conter fala para este teste completo',
);
const selection = await completed((await child(transcription.id, 'select')).id);
assert.ok(selection.result.clips.length);
const renders = await wait(async () => {
  const tasks = (await api('jobs')).filter(
    (t) => t.parentId === selection.id && t.operation === 'clip',
  );
  return tasks.length === selection.result.clips.length ? tasks : null;
});
mkdirSync('artifacts', { recursive: true });
const clips = [];
for (const task of renders) {
  const clip = await completed(task.id);
  assert.ok(
    clip.editorial.title &&
      clip.editorial.description.includes(source.attribution),
  );
  const response = await fetch(`${base}/jobs/${clip.id}/artifacts/video`, {
    headers,
  });
  assert.equal(response.status, 200);
  const file = `artifacts/collection-${clip.id}.mp4`;
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  const probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  assert.equal(probe.status, 0, probe.stderr);
  const info = JSON.parse(probe.stdout),
    video = info.streams.find((s) => s.codec_type === 'video');
  assert.equal(video.width, 720);
  assert.equal(video.height, 1280);
  assert.equal(video.codec_name, 'h264');
  assert.ok(info.streams.some((s) => s.codec_name === 'aac'));
  assert.ok(
    Math.abs(
      Number(info.format.duration) - (clip.result.end - clip.result.start),
    ) < 0.2,
  );
  const subtitle = await fetch(`${base}/jobs/${clip.id}/artifacts/subtitles`, {
    headers,
  });
  assert.equal(subtitle.status, 200);
  const srt = await subtitle.text();
  assert.match(srt, /-->/);
  writeFileSync(`artifacts/collection-${clip.id}.srt`, srt);
  const seconds = (s) => {
    const [h, m, sec, ms] = s.split(/[:,]/).map(Number);
    return h * 3600 + m * 60 + sec + ms / 1000;
  };
  const timings = [
    ...srt.matchAll(/(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})/g),
  ].map((m) => [seconds(m[1]), seconds(m[2])]);
  const expected = transcription.result.segments.filter(
    (s) => s.start < clip.result.end && s.end > clip.result.start,
  );
  assert.equal(timings.length, expected.length);
  timings.forEach(([start, end], i) => {
    assert.ok(
      Math.abs(
        start -
          (Math.max(clip.result.start, expected[i].start) - clip.result.start),
      ) <= 0.0011,
    );
    assert.ok(
      Math.abs(
        end - (Math.min(clip.result.end, expected[i].end) - clip.result.start),
      ) <= 0.0011,
    );
  });
  const frame = `artifacts/collection-${clip.id}.png`;
  assert.equal(
    spawnSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-ss',
      '1',
      '-i',
      file,
      '-frames:v',
      '1',
      frame,
    ]).status,
    0,
  );
  clips.push({
    id: clip.id,
    result: clip.result,
    editorial: clip.editorial,
    duration: info.format.duration,
    timings,
    frame,
  });
}
const report = {
  date: new Date().toISOString(),
  reference,
  source,
  download: downloaded,
  transcription,
  selection,
  clips,
  paidCalls: 0,
  realPublications: 0,
};
writeFileSync(
  'artifacts/collection-smoke.json',
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      reference,
      sourceId: source.id,
      license: source.license,
      sha1: source.evidence.sha1,
      sha256: downloaded.result.sha256,
      downloadId: initial.id,
      transcriptionId: transcription.id,
      segments: transcription.result.segments.length,
      selectionId: selection.id,
      clips,
      paidCalls: 0,
      realPublications: 0,
    },
    null,
    2,
  ),
);
