import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiProvider, LlmHttpError } from '../src/selection/provider';
import { makeRequest } from '../src/selection/service';
import {
  readSelectionConfig,
  responseFormat,
} from '../src/selection/contracts';
import { PrismaUsageLedger } from '../src/selection/ledger';
import { PrismaClient } from '@prisma/client';

const secret = 'segredo-apenas-local';
const env = (model: string) => ({
  GEMINI_API_KEY: secret,
  LLM_MODEL: model,
  LLM_ALLOW_EXTERNAL: 'true',
  GEMINI_FREE_TIER_CONFIRMED: 'true',
});
for (const model of ['gemini-3.5-flash-lite', 'gemini-2.5-flash']) {
  test(`payload REST local: ${model}, schema limitado e thinking compatível`, async () => {
    const original = JSON.stringify(responseFormat);
    let calls = 0;
    const provider = new GeminiProvider(env(model), async (url, init) => {
      calls++;
      assert.equal(
        url,
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      );
      assert.equal(init?.redirect, 'error');
      const body = JSON.parse(String(init?.body));
      assert.equal(JSON.stringify(body).includes(secret), false);
      const config = body.generationConfig;
      assert.equal(config.responseMimeType, 'application/json');
      assert.equal(config.maxOutputTokens, 3000);
      assert.equal(config.responseSchema, undefined);
      assert.equal(config.responseJsonSchema.$schema, undefined);
      const fields =
        config.responseJsonSchema.properties.clips.items.properties;
      assert.deepEqual(fields.first, {
        type: 'integer',
        minimum: 12,
        maximum: 14,
      });
      assert.deepEqual(fields.last, fields.first);
      assert.deepEqual(
        config.thinkingConfig,
        model.startsWith('gemini-2.5-') ? { thinkingBudget: 0 } : undefined,
      );
      assert.ok(body.contents.length && body.systemInstruction.parts[0].text);
      return Response.json({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: '{"clips":[]}' }] },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      });
    });
    const config = readSelectionConfig({
      LLM_MODEL: model,
      LLM_MAX_OUTPUT_TOKENS: '3000',
    });
    const result = await provider.generate(
      makeRequest(
        [
          { id: 12, start: 0, end: 4, text: 'Uma frase completa.' },
          { id: 14, start: 4, end: 8, text: 'Outra frase completa.' },
        ],
        config,
      ),
    );
    assert.equal(result.content, '{"clips":[]}');
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(responseFormat), original);
  });
}
test('HTTP 400 preserva detalhes sanitizados e não é retentável', async () => {
  const model = 'gemini-3.5-flash-lite';
  const provider = new GeminiProvider(env(model), async () =>
    Response.json(
      {
        error: {
          code: 400,
          status: 'INVALID_ARGUMENT',
          message: `Inválido ${secret}`,
          details: [
            {
              fieldViolations: [
                {
                  field: 'generationConfig.responseJsonSchema',
                  description: 'schema complexo',
                },
              ],
              apiKey: secret,
              authorization: 'Bearer secreto',
            },
          ],
        },
      },
      { status: 400 },
    ),
  );
  let diagnostic: string | undefined;
  await assert.rejects(
    () =>
      provider.generate(
        makeRequest([], readSelectionConfig({ LLM_MODEL: model })),
      ),
    (error: unknown) => {
      assert.ok(error instanceof LlmHttpError);
      assert.equal(error.retryable, false);
      diagnostic = error.diagnostic;
      assert.ok(diagnostic?.includes('fieldViolations'));
      assert.ok(diagnostic?.includes('INVALID_ARGUMENT'));
      assert.equal(diagnostic?.includes(secret), false);
      assert.equal(diagnostic?.includes('Bearer secreto'), false);
      return true;
    },
  );
  let update: unknown;
  const db = {
    llmCall: {
      updateMany: async (data: unknown) => {
        update = data;
      },
    },
  } as unknown as PrismaClient;
  await new PrismaUsageLedger(db).fail(
    {
      key: 'local',
      provider: 'gemini',
      model,
      taskId: 'local',
      inputTokens: 10,
      outputTokens: 10,
      costMicros: 0,
    },
    diagnostic,
  );
  assert.deepEqual(update, {
    where: { key: 'local', state: 'RESERVED' },
    data: { state: 'FAILED', response: { httpError: diagnostic } },
  });
});
