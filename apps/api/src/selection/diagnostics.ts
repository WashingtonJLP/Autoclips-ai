import assert from 'node:assert/strict';
import { GeminiProvider, LlmRequest } from './provider';
import { SelectionConfig } from './contracts';

// Limite documentado do modelo; sem maxOutputTokens não podemos reservar só 3000.
export const gemini35OutputLimit = 65536;

export function simpleGeminiPayload(outputCap?: 64) {
  return {
    contents: [{ role: 'user', parts: [{ text: 'Responda apenas OK.' }] }],
    ...(outputCap ? { generationConfig: { maxOutputTokens: outputCap } } : {}),
  };
}

export async function progressiveGeminiPayloads(
  request: LlmRequest,
  outputCap?: 64,
) {
  let selection: unknown;
  // Captura o payload do adaptador real usando exclusivamente transporte local.
  const provider = new GeminiProvider(
    {
      GEMINI_API_KEY: 'diagnostico-local-sem-chave-real',
      LLM_MODEL: request.model,
      LLM_ALLOW_EXTERNAL: 'true',
      GEMINI_FREE_TIER_CONFIRMED: 'true',
    },
    async (_url, init) => {
      selection = JSON.parse(String(init?.body));
      return Response.json({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: '{"clips":[]}' }] },
          },
        ],
        usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 },
      });
    },
  );
  await provider.generate(request);
  return {
    simple: simpleGeminiPayload(outputCap),
    minimalSchema: {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Retorne um objeto JSON com ok igual a true.' }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
        },
      },
    },
    selection,
  };
}

export function simpleDiagnosticReservation(
  config: SelectionConfig,
  committedTokens: string,
  outputCap?: 64,
) {
  assert.equal(config.provider, 'gemini');
  assert.equal(config.model, 'gemini-3.5-flash-lite');
  const inputTokens =
    Buffer.byteLength(JSON.stringify(simpleGeminiPayload(outputCap)), 'utf8') +
    64;
  const outputTokens = outputCap ?? gemini35OutputLimit;
  const total = inputTokens + outputTokens;
  if (total > config.runTokenBudget)
    return {
      allowed: false as const,
      reason: 'Reserva de saída excede o orçamento de tokens por execução',
      inputTokens,
      outputTokens,
    };
  if (BigInt(committedTokens) + BigInt(total) > BigInt(config.dailyTokenBudget))
    return {
      allowed: false as const,
      reason: 'Reserva de saída excede o orçamento diário de tokens',
      inputTokens,
      outputTokens,
    };
  return {
    allowed: true as const,
    inputTokens,
    outputTokens,
  };
}
