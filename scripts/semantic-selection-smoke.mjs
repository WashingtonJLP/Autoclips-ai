// Padrão: exige Gemini real. O modo heuristic valida somente o fallback identificado.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/);
  if (m && !process.env[m[1]])
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const expected = process.env.SEMANTIC_EXPECTED_ORIGIN ?? 'llm';
const fixturePath =
  process.env.SEMANTIC_FIXTURE_PATH ?? 'fixtures/semantic-speech.mp4';
assert.ok(['llm', 'heuristic'].includes(expected));
const headers = {
  Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN}`,
  'Content-Type': 'application/json',
};
async function api(path, body) {
  const r = await fetch(`http://localhost:3101/${path}`, {
    headers,
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await r.json();
  assert.ok(r.ok, `${path}: ${JSON.stringify(data)}`);
  return data;
}
async function wait(fn) {
  for (let i = 0; i < 300; i++) {
    const r = await fn();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error('Tempo esgotado na seleção');
}
await wait(async () => {
  try {
    return (
      (await fetch('http://localhost:3101/health')).ok &&
      (await fetch('http://localhost:3100/api/health')).ok
    );
  } catch {
    return false;
  }
});
const settings = await api('llm/config');
assert.equal(settings.provider, 'gemini');
if (expected === 'llm')
  assert.equal(
    settings.available,
    true,
    'Configure GEMINI_API_KEY e a autorização de consumo antes de validar IA real',
  );
const source = await api('sources', {
  name: `Teste seleção ${expected} ${Date.now()}`,
  url: 'https://github.com/WashingtonJLP/Autoclips-ai',
  license: 'PERMISSION',
  evidenceUrl:
    'https://github.com/WashingtonJLP/Autoclips-ai/blob/main/scripts/create-fixture.ps1',
  attribution:
    'Fala sintética criada localmente e imagem FFmpeg, teste autorizado sem mídia de terceiros',
  commercialUseVerified: true,
});
const root = await api('jobs', {
  sourceId: source.id,
  operation: 'transcribe',
  path: fixturePath,
  autoRun: true,
});
const chain = await wait(async () => {
  const tasks = await api('jobs'),
    ids = new Set([root.id]);
  for (let i = 0; i < 5; i++)
    for (const t of tasks) {
      if (ids.has(t.parentId)) ids.add(t.id);
      if (ids.has(t.id) && t.result?.reusedTaskId)
        ids.add(t.result.reusedTaskId);
    }
  const chain = tasks.filter((t) => ids.has(t.id));
  const failure = chain.find((t) => t.error || t.status === 'FAILED');
  assert.ok(!failure, JSON.stringify(failure));
  return chain.some(
    (t) => t.operation === 'clip' && t.status === 'COMPLETED',
  ) && chain.every((t) => t.status === 'COMPLETED')
    ? chain
    : null;
});
const transcription = chain.find((t) => t.operation === 'transcribe'),
  selection = chain.find((t) => t.operation === 'select'),
  clips = chain.filter((t) => t.operation === 'clip');
assert.ok(transcription.result.segments.length);
assert.equal(transcription.result.transcription_engine, 'faster-whisper');
assert.equal(selection.result.selectionOrigin, expected);
assert.equal(selection.result.semanticAnalysis, expected === 'llm');
assert.equal(selection.result.simulated, false);
assert.ok(selection.result.clips.every((c) => typeof c.reason === 'string'));
assert.equal(
  (await api(`jobs/${transcription.id}/select`, {})).id,
  selection.id,
  'Mesma transcrição e política devem reaproveitar a análise',
);
const usage = await api(`jobs/${selection.id}/llm-usage`);
if (expected === 'llm')
  assert.ok(
    usage.some(
      (c) =>
        c.provider === 'gemini' &&
        c.state === 'SUCCEEDED' &&
        c.outputTokens > 0,
    ),
  );
else {
  assert.equal(usage.length, 0);
  assert.ok(selection.result.warnings.length);
}
mkdirSync('artifacts', { recursive: true });
const dashboard = {
  Authorization: `Basic ${Buffer.from(`${process.env.DASHBOARD_USER}:${process.env.DASHBOARD_PASSWORD}`).toString('base64')}`,
};
for (const clip of clips) {
  assert.equal(clip.result.quality.validated, true);
  assert.equal(clip.editorial.selectionOrigin, expected);
  for (const kind of ['video', 'subtitles']) {
    const r = await fetch(
      `http://localhost:3100/api/backend/jobs/${clip.id}/artifacts/${kind}`,
      { headers: dashboard },
    );
    assert.equal(r.status, 200);
    writeFileSync(
      `artifacts/semantic-${clip.id}.${kind === 'video' ? 'mp4' : 'srt'}`,
      Buffer.from(await r.arrayBuffer()),
    );
  }
  const probe = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_streams',
      '-of',
      'json',
      `artifacts/semantic-${clip.id}.mp4`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(probe.status, 0);
  assert.ok(
    JSON.parse(probe.stdout).streams.some(
      (s) => s.codec_name === 'h264' && s.width === 720 && s.height === 1280,
    ),
  );
}
const asset = (await api('media')).find(
  (a) => a.platform === 'upload' && a.sha256,
);
if (asset) {
  const request = {
    assetId: asset.id,
    options: {
      maxClips: 1,
      minDuration: 5,
      maxDuration: 28,
      language: 'auto',
      criteria: ['hook', 'value'],
      fallback: expected === 'heuristic' ? 'heuristic' : 'none',
    },
  };
  const reused = await api('productions', request);
  assert.ok(
    reused.editorial.reusedTranscriptionId,
    'Preferências novas não devem executar Whisper novamente',
  );
  assert.equal((await api('productions', request)).id, reused.id);
  await wait(async () => {
    const all = await api('jobs'),
      ids = new Set([reused.id]);
    for (let i = 0; i < 5; i++)
      for (const t of all) {
        if (ids.has(t.parentId)) ids.add(t.id);
        if (ids.has(t.id) && t.result?.reusedTaskId)
          ids.add(t.result.reusedTaskId);
      }
    const chain = all.filter((t) => ids.has(t.id));
    const failed = chain.find((t) => t.status === 'FAILED' || t.error);
    assert.ok(!failed, JSON.stringify(failed));
    return (
      chain.some((t) => t.operation === 'clip' && t.status === 'COMPLETED') &&
      chain.every((t) => t.status === 'COMPLETED')
    );
  });
}
const report = {
  date: new Date().toISOString(),
  selectionOrigin: expected,
  fixturePath,
  geminiRealValidated: expected === 'llm',
  realWhisper: true,
  realFFmpeg: true,
  outputQualityValidated: true,
  transcription: transcription.id,
  selection: selection.id,
  clips: clips.map((t) => t.id),
  cachedSelection: true,
  transcriptReuseChecked: !!asset,
  externalCalls: usage.length,
  warnings: selection.result.warnings,
  publications: 0,
};
writeFileSync(
  `artifacts/semantic-${expected}-smoke.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
