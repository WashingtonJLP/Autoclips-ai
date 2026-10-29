// Uma única análise real; renderizar, consultar e baixar não chamam o Gemini.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sentenceSegments } = require('../apps/api/dist/selection/sentences.js');
const {
  chunksFor,
  makeRequest,
} = require('../apps/api/dist/selection/service.js');
const { estimateInput } = require('../apps/api/dist/selection/provider.js');
const allowed = new Set([
  'INTERNAL_API_TOKEN',
  'DASHBOARD_USER',
  'DASHBOARD_PASSWORD',
]);
const expectedModel = process.env.GEMINI_VALIDATION_MODEL ?? 'gemini-2.5-flash';
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/);
  if (m && allowed.has(m[1]) && !process.env[m[1]])
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const headers = {
  Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN}`,
  'Content-Type': 'application/json',
};
async function api(path, body) {
  const response = await fetch(`http://localhost:3101/${path}`, {
    headers,
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  assert.ok(response.ok, `${path}: ${JSON.stringify(data)}`);
  return data;
}
async function wait(fn, label) {
  for (let i = 0; i < 240; i++) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error(`Tempo esgotado: ${label}`);
}
const config = await api('llm/config');
assert.equal(config.provider, 'gemini');
assert.equal(config.model, expectedModel);
assert.equal(config.available, true);
assert.equal(config.simulated, false);
assert.equal(config.maxRetries, 0);
assert.equal(config.maxChunks, 1);
assert.equal(config.fallback, 'none');
assert.ok(config.geminiDailyRequestLimit <= 2);
const before = config.budget.geminiRequestsReserved;
assert.ok(
  before < 2,
  'Orçamento da validação já consumido; não enviar nova análise',
);
const transcript = (await api('jobs')).find(
  (t) =>
    t.operation === 'transcribe' &&
    t.status === 'COMPLETED' &&
    t.payload.path === 'fixtures/semantic-speech.mp4' &&
    t.result?.transcription_engine === 'faster-whisper' &&
    !t.editorial?.options,
);
assert.ok(transcript, 'Transcrição real da fixture autorizada não encontrada');
const units = sentenceSegments(transcript.result),
  chunks = chunksFor(units, config);
assert.equal(
  chunks.length,
  1,
  'O teste deve caber em uma única chamada Gemini',
);
const estimate = estimateInput(makeRequest(chunks[0], config));
assert.ok(estimate + config.maxOutputTokens <= config.runTokenBudget);
mkdirSync('artifacts', { recursive: true });
const started = await api(`jobs/${transcript.id}/select`, {});
writeFileSync(
  'artifacts/gemini-activation-request.json',
  JSON.stringify(
    {
      transcription: transcript.id,
      selection: started.id,
      before,
      estimatedInputTokens: estimate,
    },
    null,
    2,
  ),
);
const selection = await wait(async () => {
  const task = await api(`jobs/${started.id}`);
  assert.notEqual(task.status, 'FAILED', task.error);
  return task.status === 'COMPLETED' ? task : null;
}, 'análise Gemini');
const result = selection.result;
assert.equal(result.selectionOrigin, 'llm');
assert.equal(result.semanticAnalysis, true);
assert.equal(result.simulated, false);
assert.equal(result.provider, 'gemini');
assert.ok(result.clips.length >= 1);
assert.ok(result.clips.length <= config.maxClips);
const usage = await api(`jobs/${selection.id}/llm-usage`);
assert.equal(usage.length, 1);
assert.equal(usage[0].state, 'SUCCEEDED');
assert.ok(usage[0].outputTokens > 0);
const dashboard = {
  Authorization: `Basic ${Buffer.from(`${process.env.DASHBOARD_USER}:${process.env.DASHBOARD_PASSWORD}`).toString('base64')}`,
};
const clips = [];
for (const candidate of result.clips) {
  assert.equal(candidate.start, units[candidate.first].start);
  assert.equal(candidate.end, units[candidate.last].end);
  assert.ok(
    candidate.title.length &&
      candidate.reason.length &&
      Number.isFinite(candidate.score),
  );
  for (const key of [
    'hook',
    'context',
    'value',
    'clarity',
    'humor',
    'emotion',
    'engagement',
  ])
    assert.ok(candidate.scores[key] >= 0 && candidate.scores[key] <= 10);
  const queued = await api(`jobs/${selection.id}/render-selection`, {
    candidateId: candidate.id,
  });
  const clip = await wait(async () => {
    const t = await api(`jobs/${queued.id}`);
    assert.notEqual(t.status, 'FAILED', t.error);
    return t.status === 'COMPLETED' ? t : null;
  }, 'FFmpeg');
  assert.equal(clip.result.quality.validated, true);
  assert.equal(clip.editorial.selectionOrigin, 'llm');
  assert.equal(clip.editorial.selectionProvider, 'gemini');
  assert.equal(clip.editorial.simulated, false);
  for (const kind of ['video', 'subtitles']) {
    const response = await fetch(
      `http://localhost:3100/api/backend/jobs/${clip.id}/artifacts/${kind}`,
      { headers: dashboard },
    );
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 10);
    writeFileSync(
      `artifacts/gemini-${clip.id}.${kind === 'video' ? 'mp4' : 'srt'}`,
      bytes,
    );
  }
  const probe = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      `artifacts/gemini-${clip.id}.mp4`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(probe.status, 0);
  const info = JSON.parse(probe.stdout);
  assert.ok(
    info.streams.some(
      (s) => s.codec_name === 'h264' && s.width === 720 && s.height === 1280,
    ),
  );
  assert.ok(info.streams.some((s) => s.codec_name === 'aac'));
  const srt = readFileSync(`artifacts/gemini-${clip.id}.srt`, 'utf8');
  assert.match(srt, /\d\d:\d\d:\d\d,\d{3} -->/);
  writeFileSync(
    `artifacts/gemini-${clip.id}.json`,
    JSON.stringify(clip, null, 2),
  );
  clips.push({
    id: clip.id,
    title: candidate.title,
    start: candidate.start,
    end: candidate.end,
    score: candidate.score,
    scores: candidate.scores,
    reason: candidate.reason,
    duration: Number(info.format.duration),
  });
}
assert.equal(
  (await api(`jobs/${transcript.id}/select`, {})).id,
  selection.id,
  'Consulta repetida deve usar cache',
);
const after = (await api('llm/config')).budget.geminiRequestsReserved;
assert.equal(
  after - before,
  1,
  'Renderização e cache não devem enviar outra requisição',
);
const report = {
  date: new Date().toISOString(),
  provider: result.provider,
  model: result.model,
  simulated: false,
  selectionOrigin: 'llm',
  semanticAnalysis: true,
  apiRequests: after - before,
  inputTokens: usage[0].inputTokens,
  outputTokens: usage[0].outputTokens,
  totalTokens: usage[0].inputTokens + usage[0].outputTokens,
  applicationCostMicros: usage[0].costMicros,
  dailyRequestLimit: config.geminiDailyRequestLimit,
  dailyRequestsReserved: after,
  transcription: transcript.id,
  reusedRealWhisperTranscript: true,
  selection: selection.id,
  clips,
  qualityValidated: true,
  mp4AndSrtDownloaded: true,
  cachedSelection: true,
  publications: 0,
};
writeFileSync(
  'artifacts/gemini-activation-smoke.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
