// Executar no container api. Sem --live-simple: somente preparação local.
const assert = require('node:assert/strict');
const { writeFileSync, mkdirSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { readSelectionConfig } = require('../apps/api/dist/selection/contracts');
const {
  makeRequest,
  chunksFor,
} = require('../apps/api/dist/selection/service');
const { sentenceSegments } = require('../apps/api/dist/selection/sentences');
const {
  GeminiProvider,
  LlmHttpError,
} = require('../apps/api/dist/selection/provider');
const { PrismaUsageLedger } = require('../apps/api/dist/selection/ledger');
const {
  progressiveGeminiPayloads,
  simpleDiagnosticReservation,
} = require('../apps/api/dist/selection/diagnostics');

async function main() {
  const config = readSelectionConfig(process.env);
  assert.equal(config.provider, 'gemini');
  assert.equal(config.model, 'gemini-3.5-flash-lite');
  assert.equal(process.env.GEMINI_FREE_TIER_CONFIRMED, 'true');
  assert.equal(process.env.LLM_ALLOW_PAID, 'false');
  assert.equal(config.maxRetries, 0);
  assert.equal(config.fallback, 'none');
  assert.ok(config.geminiDailyRequestLimit <= 2);
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let calls = 0;
  try {
    const transcript = await db.task.findFirst({
      where: {
        operation: 'transcribe',
        status: 'COMPLETED',
        payload: { path: ['path'], equals: 'fixtures/semantic-speech.mp4' },
      },
      orderBy: { createdAt: 'asc' },
    });
    assert.ok(transcript);
    assert.equal(transcript.result.transcription_engine, 'faster-whisper');
    const chunks = chunksFor(sentenceSegments(transcript.result), config);
    assert.equal(chunks.length, 1);
    const request = makeRequest(chunks[0], config);
    const outputCap = process.argv.includes('--output-cap-64') ? 64 : undefined;
    const payloads = await progressiveGeminiPayloads(request, outputCap);
    mkdirSync('/tmp/gemini-progressive', { recursive: true });
    writeFileSync(
      '/tmp/gemini-progressive/payloads.json',
      JSON.stringify(payloads, null, 2),
    );
    const ledger = new PrismaUsageLedger(db);
    const before = await ledger.summary();
    const reservationCheck = simpleDiagnosticReservation(
      config,
      before.committedTokens,
      outputCap,
    );
    const report = {
      date: new Date().toISOString(),
      model: config.model,
      endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`,
      preparedStages: Object.keys(payloads),
      before,
      tokenBudgets: {
        run: config.runTokenBudget,
        daily: config.dailyTokenBudget,
      },
      reservationCheck,
      liveRequested: process.argv.includes('--live-simple'),
      apiCalls: 0,
    };
    const save = () => {
      report.apiCalls = calls;
      writeFileSync(
        '/tmp/gemini-progressive/report.json',
        JSON.stringify(report, null, 2),
      );
      console.log(JSON.stringify(report, null, 2));
    };
    if (!report.liveRequested) {
      save();
      return;
    }
    if (before.geminiRequestsReserved >= config.geminiDailyRequestLimit) {
      report.blocked = 'Limite diário de requisições atingido';
      save();
      return;
    }
    if (!reservationCheck.allowed) {
      report.blocked = reservationCheck.reason;
      save();
      return;
    }
    // Além do orçamento diário do ledger, respeita os limites por execução.
    const provider = new GeminiProvider(process.env, async (url, init) => {
      assert.equal(calls, 0, 'Uma única chamada; sem retries');
      assert.equal(String(url), report.endpoint);
      calls++;
      return fetch(url, { ...init, body: JSON.stringify(payloads.simple) });
    });
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          before.day,
          config.model,
          'progressive-simple-v1',
          payloads.simple,
        ]),
      )
      .digest('hex');
    // Um diagnóstico não entra na fila de produção nem dispara renderização.
    const task = await db.task.create({
      data: {
        sourceId: transcript.sourceId,
        operation: 'llm-diagnostic',
        status: 'PROCESSING',
        payload: { stage: 'simple', model: config.model },
        autoRun: false,
      },
    });
    report.taskId = task.id;
    const reservation = {
      key,
      provider: 'gemini',
      model: config.model,
      taskId: task.id,
      inputTokens: reservationCheck.inputTokens,
      outputTokens: reservationCheck.outputTokens,
      costMicros: provider.quote(
        reservationCheck.inputTokens,
        reservationCheck.outputTokens,
      ),
    };
    assert.equal(reservation.costMicros, 0);
    let reserved = false;
    try {
      const existing = await ledger.reserve(reservation, config);
      reserved = !existing.cached;
      const response =
        existing.cached ??
        (await provider.generate({
          ...request,
          maxOutputTokens: reservation.outputTokens,
        }));
      if (reserved) await ledger.settle(reservation, response);
      report.response = response;
      report.success = Boolean(response.content.trim());
      await db.task.update({
        where: { id: task.id },
        data: {
          status: 'COMPLETED',
          result: JSON.parse(JSON.stringify(response)),
        },
      });
    } catch (error) {
      if (reserved)
        await ledger.fail(
          reservation,
          error instanceof LlmHttpError ? error.diagnostic : undefined,
        );
      report.success = false;
      report.error =
        error instanceof LlmHttpError
          ? {
              status: error.status,
              message: error.message,
              body: error.diagnostic,
            }
          : 'Falha local ou de transporte; detalhes não expostos';
      await db.task.update({
        where: { id: task.id },
        data: { status: 'FAILED', error: JSON.stringify(report.error) },
      });
    }
    report.after = await ledger.summary();
    save();
    // Nunca executar minimalSchema ou selection automaticamente.
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    'Diagnóstico interrompido por falha local; não repetir sem revisar o ledger.',
  );
  process.exitCode = 1;
});
