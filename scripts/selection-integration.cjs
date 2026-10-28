// Executar no container api. Fixture ASR é um stub explícito; o corte usa FFmpeg real.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaUsageLedger } = require('../apps/api/dist/selection/ledger');
const { SelectionService } = require('../apps/api/dist/selection/service');
const { readSelectionConfig } = require('../apps/api/dist/selection/contracts');
const { MockLlmProvider } = require('../apps/api/dist/selection/provider');
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const config = readSelectionConfig({});
const path =
  process.env.SELECTION_FIXTURE_PATH ?? 'fixtures/selection-smoke.mp4';
// Porta INTERNA do container api; no host, use SELECTION_API_URL=http://127.0.0.1:3101.
const base = process.env.SELECTION_API_URL ?? 'http://127.0.0.1:3001';
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
  const text = await response.text();
  assert.equal(response.status, expected, `${path}: ${text}`);
  return JSON.parse(text);
}
async function completed(id) {
  for (let i = 0; i < 120; i++) {
    const task = await request(`/jobs/${id}`);
    if (task.status === 'FAILED') throw new Error(task.error);
    if (task.status === 'COMPLETED') return task;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Tempo esgotado');
}
async function main() {
  const settings = await request('/llm/config');
  assert.equal(settings.simulated, true);
  const source = await db.source.create({
    data: {
      name: 'Fixture seleção sintética',
      url: 'https://github.com/WashingtonJLP/Autoclips-ai',
      license: 'PERMISSION',
      evidenceUrl:
        'https://github.com/WashingtonJLP/Autoclips-ai/blob/main/scripts/create-selection-fixture.py',
      attribution:
        'Vídeo e áudio sintéticos locais. Transcrição stub apenas para validar a integração; não é resultado ASR.',
      verifiedAt: new Date(),
      commercialUseVerified: true,
    },
  });
  const transcript = {
    duration: 12,
    segments: [
      {
        start: 0,
        end: 3,
        text: 'Como melhorar seus vídeos? Comece por uma ideia clara.',
      },
      {
        start: 3,
        end: 6,
        text: 'Esta dica preserva o contexto e apresenta um exemplo útil.',
      },
      {
        start: 6,
        end: 9,
        text: 'O primeiro passo é revisar os direitos antes de editar.',
      },
      {
        start: 9,
        end: 12,
        text: 'Depois confira a legenda e a clareza da mensagem completa.',
      },
    ],
  };
  const original = await db.task.create({
    data: {
      sourceId: source.id,
      operation: 'transcribe',
      status: 'COMPLETED',
      payload: { path },
      result: transcript,
    },
  });
  const selection = await request(`/jobs/${original.id}/select`, {}, 201);
  const selected = await completed(selection.id);
  assert.equal(selected.result.simulated, true);
  assert.ok(selected.result.clips.length > 0);
  const candidate = selected.result.clips[0];
  assert.ok(candidate.start >= 0 && candidate.end <= 12);
  assert.ok(candidate.title && candidate.description);
  const calls = await db.llmCall.findMany({ where: { taskId: selection.id } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].inputTokens, 0);
  assert.equal(calls[0].costMicros, 0);
  const audit = await request(`/jobs/${selection.id}/llm-usage`);
  assert.equal(audit[0].inputTokens, 0);
  assert.equal(audit[0].costMicros, 0);
  const renders = await Promise.all([
    request(
      `/jobs/${selection.id}/render-selection`,
      { candidateId: candidate.id },
      201,
    ),
    request(
      `/jobs/${selection.id}/render-selection`,
      { candidateId: candidate.id },
      201,
    ),
  ]);
  assert.equal(
    renders[0].id,
    renders[1].id,
    'Renderização deve ser idempotente',
  );
  const rendered = await completed(renders[0].id);
  assert.equal(rendered.result.width, 720);
  assert.equal(rendered.result.height, 1280);
  assert.equal(rendered.editorial.title, candidate.title);
  // Seleção feita antes de um corte pode ficar obsoleta: a renderização revalida duplicação.
  const stale = await db.task.create({
    data: {
      sourceId: source.id,
      operation: 'select',
      status: 'COMPLETED',
      payload: { transcriptionTaskId: original.id },
    },
  });
  const staleResult = await new SelectionService(
    new MockLlmProvider(),
    new PrismaUsageLedger(db),
    { ...config, maxDuration: 9 },
  ).select(stale.id, transcript);
  assert.ok(staleResult.clips.length > 0);
  await db.task.update({
    where: { id: stale.id },
    data: { result: staleResult },
  });
  await request(
    `/jobs/${stale.id}/render-selection`,
    { candidateId: staleResult.clips[0].id },
    409,
  );
  const again = await request(`/jobs/${original.id}/select`, {}, 201);
  assert.equal((await completed(again.id)).result.clips.length, 0);
  // Reservas concorrentes usam um dia de teste isolado do orçamento operacional.
  const day = `test-${randomUUID()}`;
  const ledger = new PrismaUsageLedger(db, () => day);
  const reservation = (key) => ({
    key: `${day}-${key}`,
    taskId: selection.id,
    provider: 'test',
    model: 'test',
    inputTokens: 100,
    outputTokens: 50,
    costMicros: 10,
  });
  const limits = { ...config, dailyTokenBudget: 150, dailyCostMicros: 10 };
  const outcomes = await Promise.allSettled([
    ledger.reserve(reservation('a'), limits),
    ledger.reserve(reservation('b'), limits),
  ]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  let budget = await db.llmBudget.findUniqueOrThrow({ where: { day } });
  assert.equal(budget.tokens, 150n);
  assert.equal(budget.costMicros, 10n);
  const key = outcomes[0].status === 'fulfilled' ? 'a' : 'b';
  await ledger.settle(reservation(key), {
    content: '{"clips":[]}',
    usage: { inputTokens: 20, outputTokens: 10, costMicros: 2 },
  });
  budget = await db.llmBudget.findUniqueOrThrow({ where: { day } });
  assert.equal(budget.tokens, 30n);
  assert.equal(budget.costMicros, 2n);
  assert.ok((await ledger.reserve(reservation(key), limits)).cached);
  const missing = {
    ...reservation('missing'),
    inputTokens: 10,
    outputTokens: 10,
    costMicros: 1,
  };
  await ledger.reserve(missing, limits);
  await ledger.settle(missing, { content: '{"clips":[]}' });
  budget = await db.llmBudget.findUniqueOrThrow({ where: { day } });
  assert.equal(budget.tokens, 50n);
  assert.equal(budget.costMicros, 3n);
  const failed = { ...missing, key: `${day}-failed` };
  await ledger.reserve(failed, limits);
  await ledger.fail(failed);
  await assert.rejects(
    () => ledger.reserve(failed, limits),
    /consumo desconhecido/,
  );
  let sends = 0;
  const costDay = `test-cost-${randomUUID()}`;
  const costLedger = new PrismaUsageLedger(db, () => costDay);
  const expensive = {
    name: 'test',
    simulated: true,
    quote: () => 1,
    generate: async () => {
      sends++;
      return { content: '{"clips":[]}' };
    },
  };
  await assert.rejects(
    () =>
      new SelectionService(expensive, costLedger, {
        ...config,
        runCostMicros: 10,
        dailyCostMicros: 0,
      }).select(selection.id, transcript),
    /diário/,
  );
  assert.equal(sends, 0);
  const exceededDay = `test-exceeded-${randomUUID()}`;
  const exceededLedger = new PrismaUsageLedger(db, () => exceededDay);
  const exceeded = {
    ...reservation('exceeded'),
    key: `${exceededDay}-1`,
    inputTokens: 10,
    outputTokens: 10,
    costMicros: 1,
  };
  await exceededLedger.reserve(exceeded, limits);
  await exceededLedger.settle(exceeded, {
    content: '{}',
    usage: { inputTokens: 200, outputTokens: 20, costMicros: 11 },
  });
  const overspent = await db.llmBudget.findUniqueOrThrow({
    where: { day: exceededDay },
  });
  assert.equal(overspent.tokens, 220n);
  assert.equal(overspent.costMicros, 11n);
  await assert.rejects(
    () =>
      exceededLedger.reserve({ ...exceeded, key: `${exceededDay}-2` }, limits),
    /diário/,
  );
  console.log(
    JSON.stringify({
      selection: selected.id,
      clip: rendered.id,
      clips: selected.result.clips.length,
      provider: selected.result.provider,
      databaseBudgetTests: 'passed',
      idempotent: true,
    }),
  );
}
main()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
