import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { PrismaUsageLedger } from '../src/selection/ledger';
import { readSelectionConfig } from '../src/selection/contracts';
import { Reservation } from '../src/selection/service';
import { makeRequest } from '../src/selection/service';
import { GeminiProvider } from '../src/selection/provider';

function database(existing?: unknown) {
  const rows: unknown[] = [];
  const tx = {
    llmCall: {
      findUnique: async () => existing,
      count: async () => rows.length,
      create: async (data: unknown) => {
        rows.push(data);
      },
    },
    llmBudget: {
      upsert: async () => ({ tokens: 0n, costMicros: 0n }),
      update: async () => {},
    },
  };
  return {
    rows,
    db: {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(tx),
    } as unknown as PrismaClient,
  };
}
const config = readSelectionConfig({ GEMINI_DAILY_REQUEST_LIMIT: '2' });
const reservation = (key: string, provider = 'gemini'): Reservation => ({
  key,
  provider,
  taskId: 'test',
  model: 'gemini-2.5-flash',
  inputTokens: 100,
  outputTokens: 100,
  costMicros: 0,
});
test('limite de duas reservas Gemini bloqueia a terceira antes de qualquer transporte', async () => {
  const { db, rows } = database(),
    ledger = new PrismaUsageLedger(db);
  await ledger.reserve(reservation('1'), config);
  await ledger.reserve(reservation('2'), config);
  await assert.rejects(
    () => ledger.reserve(reservation('3'), config),
    /Limite diário/,
  );
  assert.equal(rows.length, 2);
});
test('cache não consome requisição e limite Gemini não altera outros provedores', async () => {
  const cached = database({
    state: 'SUCCEEDED',
    response: { content: '{"clips":[]}' },
  });
  assert.ok(
    (
      await new PrismaUsageLedger(cached.db).reserve(reservation('cached'), {
        ...config,
        geminiDailyRequestLimit: 0,
      })
    ).cached,
  );
  assert.equal(cached.rows.length, 0);
  const { db, rows } = database();
  await new PrismaUsageLedger(db).reserve(reservation('mock', 'mock'), {
    ...config,
    geminiDailyRequestLimit: 0,
  });
  assert.equal(rows.length, 1);
});
test('erro oficial Gemini preserva diagnóstico, sem expor chave no erro', async () => {
  const config = readSelectionConfig({ LLM_MODEL: 'gemini-2.5-flash' });
  const provider = new GeminiProvider(
    {
      GEMINI_API_KEY: 'segredo-ficticio-unitario',
      LLM_MODEL: config.model,
      LLM_ALLOW_EXTERNAL: 'true',
      GEMINI_FREE_TIER_CONFIRMED: 'true',
    },
    async () =>
      Response.json(
        {
          error: { message: 'Model not available; segredo-ficticio-unitario' },
        },
        { status: 404 },
      ),
  );
  await assert.rejects(
    () => provider.generate(makeRequest([], config)),
    (error: Error) =>
      error.message.includes('Model not available') &&
      !error.message.includes('segredo-ficticio-unitario'),
  );
});
