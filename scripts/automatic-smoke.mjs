// ASR/FFmpeg reais e seleção mock. Não chama APIs de IA nem publica vídeos.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

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
  const data = await response.json();
  assert.ok(response.ok, `${path}: ${JSON.stringify(data)}`);
  return data;
}
async function until(fn, label) {
  for (let i = 0; i < 600; i++) {
    const result = await fn();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Tempo esgotado: ${label}`);
}
async function completed(id) {
  return until(async () => {
    const task = await api(`jobs/${id}`);
    assert.notEqual(task.status, 'FAILED', task.error);
    if (task.status === 'COMPLETED') {
      assert.equal(task.error, null, task.error);
      return task;
    }
  }, id);
}
const settings = await api('llm/config');
assert.equal(
  settings.provider,
  'mock',
  'Este teste só permite mock, mesmo com credenciais reais no ambiente',
);
assert.equal(
  (await fetch(`${base}/jobs`)).status,
  401,
  'API deve exigir token',
);
assert.equal(
  (await fetch('http://127.0.0.1:3000/')).status,
  401,
  'Dashboard deve exigir autenticação',
);
const dashboardHeaders = {
  Authorization: `Basic ${Buffer.from(`${process.env.DASHBOARD_USER}:${process.env.DASHBOARD_PASSWORD}`).toString('base64')}`,
};
assert.equal(
  (await fetch('http://127.0.0.1:3000/', { headers: dashboardHeaders })).status,
  200,
);
assert.equal(
  (
    await fetch('http://127.0.0.1:3000/api/backend/jobs', {
      method: 'POST',
      headers: {
        ...dashboardHeaders,
        Origin: 'https://evil.invalid',
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
  ).status,
  403,
);
const source = await api('sources', {
  name: `E2E fala sintética ${new Date().toISOString()}`,
  url: 'https://github.com/WashingtonJLP/Autoclips-ai',
  license: 'PERMISSION',
  evidenceUrl:
    'https://github.com/WashingtonJLP/Autoclips-ai/blob/main/scripts/create-fixture.ps1',
  attribution:
    'Teste autorizado: fala sintetizada localmente com System.Speech e imagem gerada pelo FFmpeg. Sem mídia de terceiros.',
  commercialUseVerified: true,
});
const initial = await api('jobs', {
  sourceId: source.id,
  operation: 'transcribe',
  path: process.env.AUTOMATIC_FIXTURE_PATH ?? 'fixtures/authorized-speech.mp4',
  autoRun: true,
});
const transcription = await completed(initial.id);
assert.ok(transcription.result.segments.length);
const expectedSpeech =
  process.env.AUTOMATIC_FIXTURE_LANGUAGE === 'pt'
    ? 'Este é um teste local para o Auto Clips. Nós criamos vídeos curtos usando conteúdo autorizado. O sistema transcreve a fala e prepara cortes verticais.'
    : 'This is a local test for Auto Clips. We create short videos using authorized content. The system transcribes speech and prepares vertical clips.';
const words = (value) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
const referenceWords = words(expectedSpeech),
  actualWords = words(
    transcription.result.segments.map((s) => s.text).join(' '),
  );
let distance = Array.from({ length: actualWords.length + 1 }, (_, i) => i);
referenceWords.forEach((word, i) => {
  const next = [i + 1];
  actualWords.forEach((actual, j) =>
    next.push(
      Math.min(
        next[j] + 1,
        distance[j + 1] + 1,
        distance[j] + Number(word !== actual),
      ),
    ),
  );
  distance = next;
});
const wordErrorRate = distance[actualWords.length] / referenceWords.length;
assert.ok(
  wordErrorRate <= 0.25,
  `Qualidade ASR insuficiente: WER=${wordErrorRate}. Confira o idioma da voz e da fixture.`,
);
assert.match(
  transcription.result.segments.map((s) => s.text).join(' '),
  /short|video|clips|system/i,
);
assert.ok(transcription.result.segments.some((s) => s.words?.length));
const selected = await until(
  async () =>
    (await api('jobs')).find(
      (t) => t.parentId === initial.id && t.operation === 'select',
    ),
  'seleção automática',
);
const selection = await completed(selected.id);
assert.ok(selection.result.clips.length);
const renders = await until(async () => {
  const tasks = (await api('jobs')).filter(
    (t) => t.parentId === selected.id && t.operation === 'clip',
  );
  return tasks.length === selection.result.clips.length ? tasks : null;
}, 'cortes automáticos');
const clips = await Promise.all(renders.map((t) => completed(t.id)));
mkdirSync('artifacts', { recursive: true });
function probe(path) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const reports = [];
for (const clip of clips) {
  const video = await fetch(`${base}/jobs/${clip.id}/artifacts/video`, {
    headers,
  });
  assert.equal(video.status, 200);
  assert.match(video.headers.get('content-type'), /video\/mp4/);
  const path = `artifacts/${clip.id}.mp4`;
  writeFileSync(path, Buffer.from(await video.arrayBuffer()));
  const info = probe(path),
    stream = info.streams.find((s) => s.codec_type === 'video');
  assert.equal(stream.width, 720);
  assert.equal(stream.height, 1280);
  assert.equal(stream.codec_name, 'h264');
  assert.equal(
    info.streams.find((s) => s.codec_type === 'audio').codec_name,
    'aac',
  );
  assert.ok(
    Math.abs(
      Number(info.format.duration) - (clip.result.end - clip.result.start),
    ) < 0.2,
  );
  assert.ok(
    clip.editorial.title &&
      clip.editorial.description.includes(source.attribution),
  );
  const subtitle = await fetch(`${base}/jobs/${clip.id}/artifacts/subtitles`, {
    headers,
  });
  assert.equal(subtitle.status, 200);
  const srt = await subtitle.text();
  writeFileSync(`artifacts/${clip.id}.srt`, srt);
  const seconds = (stamp) => {
    const [h, m, s, ms] = stamp.split(/[:,]/).map(Number);
    return h * 3600 + m * 60 + s + ms / 1000;
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
    assert.ok(
      start >= 0 && end > start && end <= Number(info.format.duration) + 0.05,
    );
  });
  const frame = `artifacts/${clip.id}.png`;
  const screenshot = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-ss', '1', '-i', path, '-frames:v', '1', frame],
    { encoding: 'utf8' },
  );
  assert.equal(screenshot.status, 0, screenshot.stderr);
  const scheduledAt = new Date(Date.now() + 2000).toISOString();
  const schedule = await api(`jobs/${clip.id}/schedule`, {
    platform: 'youtube',
    scheduledAt,
  });
  const duplicate = await api(`jobs/${clip.id}/schedule`, {
    platform: 'youtube',
    scheduledAt,
  });
  assert.equal(schedule.id, duplicate.id);
  const publication = await until(
    async () =>
      (await api('platforms')).publications.find(
        (p) => p.id === schedule.id && p.status === 'SIMULATED',
      ),
    'simulação agendada',
  );
  assert.equal(publication.result.published, false);
  const renderedAgain = await api(`jobs/${selected.id}/render-selection`, {
    candidateId: clip.editorial.candidateId,
  });
  assert.equal(renderedAgain.id, clip.id);
  const artifactViaDashboard = await fetch(
    `http://127.0.0.1:3000/api/backend/jobs/${clip.id}/artifacts/video`,
    { headers: dashboardHeaders },
  );
  assert.equal(artifactViaDashboard.status, 200);
  assert.equal(
    Buffer.from(await artifactViaDashboard.arrayBuffer()).byteLength,
    Number(info.format.size),
  );
  reports.push({
    id: clip.id,
    video: clip.result.video_path,
    subtitles: clip.result.subtitle_path,
    duration: info.format.duration,
    timings,
    publicationId: publication.id,
    frame,
  });
}
const report = {
  date: new Date().toISOString(),
  sourceId: source.id,
  transcriptionId: initial.id,
  transcript: transcription.result,
  selectionId: selected.id,
  simulatedSelection: true,
  wordErrorRate,
  clips: reports,
  paidCalls: 0,
  realPublications: 0,
};
writeFileSync(
  'artifacts/automatic-smoke.json',
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      transcription: initial.id,
      segments: transcription.result.segments.length,
      selection: selected.id,
      wordErrorRate,
      clips: reports,
      paidCalls: 0,
      realPublications: 0,
    },
    null,
    2,
  ),
);
