import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  progressiveGeminiPayloads,
  simpleGeminiPayload,
  simpleDiagnosticReservation,
} from '../src/selection/diagnostics';
import { makeRequest } from '../src/selection/service';
import { readSelectionConfig } from '../src/selection/contracts';

const config = readSelectionConfig({
  LLM_PROVIDER: 'gemini',
  LLM_MODEL: 'gemini-3.5-flash-lite',
});
test('teto autorizado de 64 tokens é a única configuração do teste simples', () => {
  assert.deepEqual(simpleGeminiPayload(64), {
    contents: [{ role: 'user', parts: [{ text: 'Responda apenas OK.' }] }],
    generationConfig: { maxOutputTokens: 64 },
  });
  const reservation = simpleDiagnosticReservation(
    { ...config, runTokenBudget: 20000, dailyTokenBudget: 40000 },
    '6905',
    64,
  );
  assert.equal(reservation.allowed, true);
  assert.equal(reservation.outputTokens, 64);
  assert.equal(
    simpleDiagnosticReservation({ ...config, runTokenBudget: 0 }, '0', 64)
      .allowed,
    false,
  );
  assert.equal(
    simpleDiagnosticReservation(
      { ...config, dailyTokenBudget: 6905 },
      '6905',
      64,
    ).allowed,
    false,
  );
});
test('três estágios locais: simples sem opcionais, schema mínimo e payload real', async () => {
  const payloads = await progressiveGeminiPayloads(
    makeRequest(
      [
        {
          id: 3,
          start: 0,
          end: 10,
          text: 'Uma ideia completa para selecionar.',
        },
      ],
      config,
    ),
  );
  assert.deepEqual(Object.keys(payloads.simple), ['contents']);
  assert.equal(payloads.simple.contents[0].role, 'user');
  assert.deepEqual(
    Object.keys(payloads.minimalSchema.generationConfig).sort(),
    ['responseJsonSchema', 'responseMimeType'],
  );
  assert.deepEqual(
    payloads.minimalSchema.generationConfig.responseJsonSchema.properties,
    { ok: { type: 'boolean' } },
  );
  const selection = payloads.selection as {
    generationConfig: {
      responseJsonSchema: {
        properties: {
          clips: { items: { properties: { first: { maximum: number } } } };
        };
      };
      thinkingConfig?: unknown;
    };
    systemInstruction: unknown;
  };
  assert.ok(selection.systemInstruction);
  assert.equal(selection.generationConfig.thinkingConfig, undefined);
  assert.equal(
    selection.generationConfig.responseJsonSchema.properties.clips.items
      .properties.first.maximum,
    3,
  );
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(payloads)));
});
test('diagnóstico sem limite de saída respeita orçamento por execução e diário', () => {
  assert.equal(
    simpleDiagnosticReservation({ ...config, runTokenBudget: 20000 }, '0')
      .allowed,
    false,
  );
  assert.equal(
    simpleDiagnosticReservation(
      { ...config, runTokenBudget: 100000, dailyTokenBudget: 40000 },
      '6905',
    ).allowed,
    false,
  );
  assert.equal(
    simpleDiagnosticReservation(
      { ...config, runTokenBudget: 100000, dailyTokenBudget: 100000 },
      '0',
    ).allowed,
    true,
  );
});
