import assert from 'node:assert/strict';

const base = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3101';
async function request(path, body, expected = 200) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN ?? ''}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(
    response.status,
    expected,
    `${path}: ${await response.clone().text()}`,
  );
  return response.json();
}
async function poll(path, done, limit = 120) {
  for (let attempt = 0; attempt < limit; attempt++) {
    const result = await request(path);
    if (done(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Tempo esgotado: ${path}`);
}
assert.equal((await request('/ready')).status, 'ok');
assert.equal((await request('/internal/echo', {}, 201)).service, 'worker');
const probe = await request('/internal/queue-test', {}, 201);
const queue = await poll(
  `/internal/queue-test/${probe.id}`,
  (r) => r.state === 'completed' && r.result !== null,
);
assert.equal(queue.result.message, 'Teste BullMQ');
await request('/sources', { name: 'Sem autorização' }, 400);
const source = await request(
  '/sources',
  {
    name: `Fixture sintética ${Date.now()}`,
    url: 'https://github.com/WashingtonJLP/Autoclips-ai',
    license: 'PERMISSION',
    evidenceUrl:
      'https://github.com/WashingtonJLP/Autoclips-ai/blob/main/scripts/create-fixture.ps1',
    attribution:
      'Fixture de teste gerada localmente com System.Speech e FFmpeg; revisão do operador restrita a este teste.',
    commercialUseVerified: true,
  },
  201,
);
assert.ok((await request('/sources')).some((entry) => entry.id === source.id));
if (process.argv.includes('--media') || process.argv.includes('--transcribe')) {
  const task = await request(
    '/jobs',
    {
      sourceId: source.id,
      path: 'fixtures/sample.mp4',
      operation: 'transcribe',
    },
    201,
  );
  const result = await poll(
    `/jobs/${task.id}`,
    (r) => ['COMPLETED', 'FAILED'].includes(r.status),
    600,
  );
  assert.equal(result.status, 'COMPLETED', result.error);
  assert.ok(result.result.segments.length > 0, 'Transcrição deve conter fala');
  console.log(
    `Transcrição aprovada: ${result.id}, ${result.result.segments.length} segmentos.`,
  );
  if (process.argv.includes('--media')) {
    const clip = await request(
      '/jobs',
      {
        sourceId: source.id,
        path: 'fixtures/sample.mp4',
        operation: 'clip',
        start: 0,
        end: 4,
        segments: result.result.segments.map(({ start, end, text }) => ({
          start,
          end,
          text,
        })),
        burn_subtitles: true,
      },
      201,
    );
    const cut = await poll(`/jobs/${clip.id}`, (r) =>
      ['COMPLETED', 'FAILED'].includes(r.status),
    );
    assert.equal(cut.status, 'COMPLETED', cut.error);
    assert.equal(cut.result.width, 720);
    assert.equal(cut.result.height, 1280);
    const publication = await request(`/jobs/${clip.id}/publish`, {}, 201);
    assert.equal(publication.published, false);
    console.log(
      JSON.stringify(
        {
          transcription: result.id,
          segments: result.result.segments.length,
          clip: cut.id,
          video: cut.result.video_path,
          subtitles: cut.result.subtitle_path,
          publication,
        },
        null,
        2,
      ),
    );
  }
}
console.log(
  'Smoke aprovado: persistência, direitos, fila e comunicação interna.',
);
