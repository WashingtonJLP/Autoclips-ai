import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Automations } from '../src/automation';
import type { Pipeline } from '../src/pipeline';
import { readSelectionConfig, Transcript } from '../src/selection/contracts';
import { sentenceSegments } from '../src/selection/sentences';
import {
  GeminiProvider,
  LlmHttpError,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  UnavailableProvider,
  estimateInput,
} from '../src/selection/provider';
import {
  SelectionService,
  UsageLedger,
  Reservation,
  makeRequest,
} from '../src/selection/service';

const config = {
  ...readSelectionConfig({
    LLM_PROVIDER: 'gemini',
    LLM_MODEL: 'gemini-2.5-flash',
  }),
  maxInputTokens: 12000,
  runTokenBudget: 100000,
};
const words =
  'Por que o céu muda de cor? A luz azul se espalha mais facilmente. Esse efeito também explica o pôr do sol.'
    .split(' ')
    .map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.45 }));
const transcript: Transcript = {
  duration: 12,
  segments: [
    {
      start: 0,
      end: words.at(-1)!.end,
      text: words.map((w) => w.word).join(' '),
      words,
    },
  ],
};
const clip = () => ({
  first: 0,
  last: 1,
  title: 'Por que o céu muda de cor?',
  description: 'Entenda o espalhamento da luz e sua relação com o céu.',
  reason:
    'A pergunta inicial cria curiosidade e a frase seguinte entrega uma explicação completa.',
  scores: {
    hook: 9,
    context: 8,
    clarity: 9,
    value: 9,
    humor: 0,
    emotion: 1,
    engagement: 8,
  },
});
class Ledger implements UsageLedger {
  reservations: Reservation[] = [];
  failures = 0;
  cache = new Map<string, LlmResponse>();
  async reserve(r: Reservation) {
    this.reservations.push(r);
    return { cached: this.cache.get(r.key) };
  }
  async settle(r: Reservation, value: LlmResponse) {
    this.cache.set(r.key, value);
  }
  async fail() {
    this.failures++;
  }
}
class Provider implements LlmProvider {
  name = 'gemini';
  simulated = false;
  calls = 0;
  requests: LlmRequest[] = [];
  quote() {
    return 0;
  }
  async generate(request: LlmRequest) {
    this.calls++;
    this.requests.push(request);
    return {
      content: JSON.stringify({ clips: [clip()] }),
      usage: { inputTokens: 20, outputTokens: 30, costMicros: 0 },
    };
  }
}
test('frases usam timestamps reais de palavras, preservam a transcrição e não inventam limites', async () => {
  const snapshot = JSON.stringify(transcript),
    units = sentenceSegments(transcript);
  assert.equal(units.length, 3);
  assert.equal(units[1].end, words[13].end);
  const provider = new Provider();
  const result = await new SelectionService(
    provider,
    new Ledger(),
    config,
  ).select('task', transcript);
  assert.equal(result.version, 2);
  assert.equal(result.selectionOrigin, 'llm');
  assert.equal(result.clips[0].end, words[13].end);
  assert.match(result.clips[0].reason!, /pergunta/);
  assert.equal(JSON.stringify(transcript), snapshot);
  assert.match(JSON.stringify(provider.requests[0]), /humor/);
});
test('fala ausente, música e cauda incompleta não são enviados à IA', async () => {
  const p = new Provider();
  const result = await new SelectionService(p, new Ledger(), config).select(
    'noise',
    {
      duration: 20,
      segments: [
        { start: 0, end: 5, text: '[Music]' },
        { start: 6, end: 15, text: 'Uma frase sem a conclusão' },
      ],
    },
  );
  assert.equal(result.clips.length, 0);
  assert.equal(p.calls, 0);
  assert.equal(result.semanticAnalysis, false);
  assert.equal(result.selectionOrigin, 'none');
});
test('sem palavras agrupa segmentos completos, sem interpolação de frases internas', () => {
  const units = sentenceSegments({
    duration: 12,
    segments: [
      { start: 0.2, end: 4.3, text: 'Como explicar isso' },
      { start: 4.3, end: 9.1, text: 'de uma forma completa?' },
    ],
  });
  assert.equal(units.length, 1);
  assert.equal(units[0].start, 0.2);
  assert.equal(units[0].end, 9.1);
});
test('candidato sem contexto ou com timestamps inexistentes é descartado sem fabricar corte', async () => {
  for (const candidate of [
    { ...clip(), last: 999 },
    { ...clip(), scores: { ...clip().scores, context: 2 } },
  ]) {
    const p = new Provider();
    p.generate = async () => ({
      content: JSON.stringify({ clips: [candidate] }),
      usage: { inputTokens: 1, outputTokens: 1, costMicros: 0 },
    });
    assert.equal(
      (
        await new SelectionService(p, new Ledger(), config).select(
          'invalid',
          transcript,
        )
      ).clips.length,
      0,
    );
  }
});
test('429 recebe tentativa limitada com reservas separadas; cache não repete inferência', async () => {
  const p = new Provider(),
    ledger = new Ledger(),
    original = p.generate.bind(p);
  let calls = 0;
  p.generate = async (request) => {
    if (calls++ === 0) throw new LlmHttpError(429);
    return original(request);
  };
  const service = new SelectionService(p, ledger, { ...config, maxRetries: 1 });
  const result = await service.select('retry', transcript);
  assert.equal(result.clips.length, 1);
  assert.equal(calls, 2);
  assert.equal(ledger.failures, 1);
  assert.notEqual(ledger.reservations[0].key, ledger.reservations[1].key);
  const cachedProvider = new Provider();
  const cache = new Ledger();
  await new SelectionService(cachedProvider, cache, config).select(
    'one',
    transcript,
    [],
    'same-file',
  );
  const reused = await new SelectionService(cachedProvider, cache, {
    ...config,
    minScore: 6,
  }).select('two', transcript, [], 'same-file');
  assert.equal(cachedProvider.calls, 1);
  assert.equal(reused.consumption[0].cached, true);
});
test('falha de rede não repete consumo desconhecido; fallback é opcional e identificado', async () => {
  const p = new Provider();
  let calls = 0;
  p.generate = async () => {
    calls++;
    throw Error('timeout');
  };
  await assert.rejects(
    () =>
      new SelectionService(p, new Ledger(), config).select('fail', transcript),
    /consumo desconhecido/,
  );
  assert.equal(calls, 1);
  const ledger = new Ledger();
  const fallback = await new SelectionService(
    new UnavailableProvider('gemini', 'Chave não configurada'),
    ledger,
    { ...config, fallback: 'heuristic' },
  ).select('fallback', transcript);
  assert.equal(fallback.selectionOrigin, 'heuristic');
  assert.equal(fallback.semanticAnalysis, false);
  assert.match(fallback.warnings[0], /Chave/);
  assert.ok(fallback.clips.length);
  assert.equal(ledger.reservations.length, 0);
});
test('limites de orçamento impedem chamadas e novas tentativas, mesmo com fallback habilitado', async () => {
  const p = new Provider();
  await assert.rejects(
    () =>
      new SelectionService(p, new Ledger(), {
        ...config,
        runTokenBudget: 0,
        fallback: 'heuristic',
      }).select('budget', transcript),
    /Orçamento/,
  );
  assert.equal(p.calls, 0);
});
test('Gemini REST usa schema, cabeçalho de chave e pensamento limitado; nunca é chamada real neste teste', async () => {
  const provider = new GeminiProvider(
    {
      LLM_ALLOW_EXTERNAL: 'true',
      GEMINI_API_KEY: 'chave-ficticia',
      LLM_MODEL: config.model,
      GEMINI_FREE_TIER_CONFIRMED: 'true',
    },
    async (url, init) => {
      assert.match(
        String(url),
        /v1beta\/models\/gemini-2.5-flash:generateContent$/,
      );
      const body = JSON.parse(String(init?.body));
      assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 0);
      assert.ok(
        body.generationConfig.responseJsonSchema.properties.clips.items.required.includes(
          'reason',
        ),
      );
      return Response.json({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: JSON.stringify({ clips: [clip()] }) }] },
          },
        ],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 80 },
      });
    },
  );
  const result = await new SelectionService(
    provider,
    new Ledger(),
    config,
  ).select('rest-fake', transcript);
  assert.equal(result.clips.length, 1);
  assert.equal(result.consumption[0].usage?.inputTokens, 50);
});
test('nova tentativa não ultrapassa o limite da execução e 503 termina em fallback visível', async () => {
  const p = new Provider();
  let calls = 0;
  p.generate = async () => {
    calls++;
    throw new LlmHttpError(503);
  };
  const budget =
    estimateInput(makeRequest(sentenceSegments(transcript), config)) +
    config.maxOutputTokens;
  await assert.rejects(
    () =>
      new SelectionService(p, new Ledger(), {
        ...config,
        runTokenBudget: budget,
        fallback: 'heuristic',
      }).select('retry-budget', transcript),
    /Orçamento/,
  );
  assert.equal(calls, 1);
  calls = 0;
  const result = await new SelectionService(p, new Ledger(), {
    ...config,
    maxRetries: 1,
    fallback: 'heuristic',
  }).select('503', transcript);
  assert.equal(calls, 2);
  assert.equal(result.selectionOrigin, 'heuristic');
  assert.equal(result.consumption.length, 2);
  assert.ok(result.consumption.every((c) => c.usage === null));
});
test('busca temática encaminha critérios e fallback somente para candidatos elegíveis', async () => {
  let forwarded: unknown;
  const automation = {
    id: 'topic',
    enabled: true,
    config: {
      platforms: ['commons'],
      keywords: 'ciência',
      autoProcess: true,
      options: {
        maxClips: 2,
        minDuration: 8,
        maxDuration: 45,
        language: 'pt',
        criteria: ['humor', 'value'],
        fallback: 'heuristic',
      },
    },
  };
  const p = {
    db: {
      automation: { findUniqueOrThrow: async () => automation },
      searchRun: {
        create: async () => ({ id: 'run' }),
        update: async (data: unknown) => data,
      },
      source: { findUnique: async () => ({ license: 'PERMISSION' }) },
    },
    production: {
      start: async (body: unknown) => {
        forwarded = body;
      },
    },
  };
  const service = new Automations(p as unknown as Pipeline);
  service.search = async () => ({
    items: [
      {
        id: 'authorized',
        rightsConfirmed: true,
        accessible: true,
        sourceId: 'source',
      },
      {
        id: 'blocked',
        rightsConfirmed: false,
        accessible: true,
        sourceId: null,
      },
    ] as never,
    errors: [],
  });
  await service.run('topic');
  assert.deepEqual(forwarded, {
    assetId: 'authorized',
    options: automation.config.options,
  });
});
