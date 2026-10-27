import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readSelectionConfig,
  transcriptSchema,
  SelectionError,
} from '../src/selection/contracts';
import {
  createProvider,
  estimateInput,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  MockLlmProvider,
  OllamaProvider,
} from '../src/selection/provider';
import {
  chunksFor,
  makeRequest,
  Reservation,
  SelectionService,
  UsageLedger,
} from '../src/selection/service';

const config = readSelectionConfig({});
const transcript = {
  duration: 60,
  segments: Array.from({ length: 6 }, (_, i) => ({
    start: i * 10,
    end: (i + 1) * 10,
    text: `Como aprender a etapa ${i + 1}? Esta dica explica um exemplo completo com contexto e clareza.`,
  })),
};
const pick = (first = 0, last = 2) => ({
  first,
  last,
  title: 'Um caminho para aprender com clareza',
  description:
    'Entenda esta etapa e aplique a ideia apresentada no contexto da conversa.',
  scores: { hook: 8, context: 7, value: 9, clarity: 8 },
});
class Ledger implements UsageLedger {
  calls: Reservation[] = [];
  settled: LlmResponse[] = [];
  failed = 0;
  async reserve(r: Reservation) {
    this.calls.push(r);
    return {};
  }
  async settle(_r: Reservation, response: LlmResponse) {
    this.settled.push(response);
  }
  async fail() {
    this.failed++;
  }
}
class Provider implements LlmProvider {
  name = 'test';
  simulated = true;
  requests: LlmRequest[] = [];
  constructor(
    public response: LlmResponse = {
      content: JSON.stringify({ clips: [pick()] }),
    },
    public cost: number | null = 0,
  ) {}
  quote() {
    return this.cost;
  }
  async generate(request: LlmRequest) {
    this.requests.push(request);
    return this.response;
  }
}
test('seleção deriva timestamps reais, pontua e classifica sem alterar a transcrição', async () => {
  const ledger = new Ledger();
  const provider = new Provider();
  const result = await new SelectionService(provider, ledger, config).select(
    'task',
    transcript,
  );
  assert.equal(result.clips[0].start, 0);
  assert.equal(result.clips[0].end, 30);
  assert.equal(result.clips[0].score, 8);
  assert.equal(result.clips[0].classification, 'destaque');
  assert.equal(ledger.settled.length, 1);
  assert.equal(result.consumption[0].usage, null);
  assert.ok(!JSON.stringify(provider.requests).includes('words'));
});
test('respostas malformadas, notas inválidas, IDs inexistentes e duração imprópria falham após registrar consumo', async () => {
  for (const content of [
    'não é JSON',
    '{"clips":{}}',
    JSON.stringify({
      clips: [
        { ...pick(), scores: { hook: 11, context: 7, value: 8, clarity: 8 } },
      ],
    }),
    JSON.stringify({ clips: [pick(0, 99)] }),
    JSON.stringify({ clips: [pick(3, 0)] }),
  ]) {
    const ledger = new Ledger();
    await assert.rejects(
      () =>
        new SelectionService(
          new Provider({
            content,
            usage: { inputTokens: 20, outputTokens: 10 },
          }),
          ledger,
          config,
        ).select('task', transcript),
      SelectionError,
    );
    assert.equal(ledger.settled.length, 1);
  }
  await assert.rejects(
    () =>
      new SelectionService(new Provider(), new Ledger(), {
        ...config,
        maxDuration: 15,
      }).select('task', transcript),
    /duração/,
  );
});
test('timestamps negativos, sobrepostos, infinitos ou além da duração não são enviados', async () => {
  for (const segment of [
    { start: -1, end: 5, text: 'Teste' },
    { start: 2, end: 1, text: 'Teste' },
    { start: 0, end: Infinity, text: 'Teste' },
    { start: 0, end: 100, text: 'Teste' },
  ]) {
    assert.equal(
      transcriptSchema.safeParse({ duration: 10, segments: [segment] }).success,
      false,
    );
  }
  assert.equal(
    transcriptSchema.safeParse({
      duration: 10,
      segments: [
        { start: 0, end: 5, text: 'a' },
        { start: 4, end: 8, text: 'b' },
      ],
    }).success,
    false,
  );
});
test('remove duplicados temporais e textuais, prioriza maior nota e evita cortes existentes', async () => {
  const repeated = {
    ...transcript,
    segments: transcript.segments.map((s) => ({
      ...s,
      text: 'Como aprender? Esta dica explica um exemplo completo com contexto e clareza.',
    })),
  };
  const provider = new Provider({
    content: JSON.stringify({
      clips: [
        { ...pick(), scores: { hook: 4, context: 4, value: 4, clarity: 4 } },
        pick(),
        pick(1, 3),
        pick(3, 5),
      ],
    }),
  });
  const result = await new SelectionService(
    provider,
    new Ledger(),
    config,
  ).select('task', repeated);
  assert.equal(result.clips.length, 1);
  assert.equal(result.clips[0].score, 8);
  const excluded = await new SelectionService(
    new Provider(),
    new Ledger(),
    config,
  ).select('task', transcript, [{ start: 0, end: 30 }]);
  assert.equal(excluded.clips.length, 0);
});
test('preflight bloqueia tokens, preços desconhecidos e orçamento antes de qualquer envio', async () => {
  for (const [limits, cost] of [
    [{ runTokenBudget: 0 }, 0],
    [{ runCostMicros: 0 }, 1],
    [{}, null],
  ] as const) {
    const provider = new Provider(undefined, cost);
    const ledger = new Ledger();
    await assert.rejects(
      () =>
        new SelectionService(provider, ledger, { ...config, ...limits }).select(
          'task',
          transcript,
        ),
      SelectionError,
    );
    assert.equal(provider.requests.length, 0);
    assert.equal(ledger.calls.length, 0);
  }
  const ledger = new Ledger();
  const provider = new Provider(undefined, 5);
  await new SelectionService(provider, ledger, {
    ...config,
    runCostMicros: 5,
  }).select('task', transcript);
  assert.equal(ledger.calls[0].costMicros, 5);
});
test('falha de API e métricas inválidas retêm a reserva; excesso informado interrompe a seleção', async () => {
  const ledger = new Ledger();
  const provider = new Provider();
  provider.generate = async () => {
    throw new Error('timeout');
  };
  await assert.rejects(
    () =>
      new SelectionService(provider, ledger, config).select('task', transcript),
    /reserva mantida/,
  );
  assert.equal(ledger.failed, 1);
  const invalid = new Ledger();
  await assert.rejects(() =>
    new SelectionService(
      new Provider({ content: '{}', usage: { inputTokens: -1 } }),
      invalid,
      config,
    ).select('task', transcript),
  );
  assert.equal(invalid.failed, 1);
  const exceeded = new Ledger();
  await assert.rejects(
    () =>
      new SelectionService(
        new Provider({ content: '{}', usage: { outputTokens: 99999 } }),
        exceeded,
        config,
      ).select('task', transcript),
    /excedeu/,
  );
  assert.equal(exceeded.settled.length, 1);
});
test('blocos respeitam o limite, mantêm contexto e rejeitam transcrição grande antes de chamadas', () => {
  const segments = Array.from({ length: 50 }, (_, id) => ({
    id,
    start: id * 10,
    end: id * 10 + 10,
    text: 'contexto '.repeat(20),
  }));
  const limits = { ...config, maxInputTokens: 3000, maxChunks: 30 };
  const chunks = chunksFor(segments, limits);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((s) => estimateInput(makeRequest(s, limits)) <= 3000));
  assert.ok(chunks[1][0].id <= chunks[0].at(-1)!.id);
  assert.throws(
    () => chunksFor(segments, { ...limits, maxChunks: 1 }),
    /blocos/,
  );
});
test('simulador é determinístico e nenhuma configuração padrão habilita rede', async () => {
  assert.equal(createProvider(config).name, 'mock');
  assert.throws(
    () => createProvider({ ...config, provider: 'ollama' }, {}),
    /habilitadas/,
  );
  assert.throws(() => new OllamaProvider('https://ollama.com'), /local/);
  const service = new SelectionService(
    new MockLlmProvider(),
    new Ledger(),
    config,
  );
  assert.deepEqual(
    (await service.select('a', transcript)).clips,
    (await service.select('b', transcript)).clips,
  );
});
test('adaptador Ollama envia schema e limites, registra tokens e trata API e resposta inválida', async () => {
  let sent: Record<string, unknown> = {};
  const transport: typeof fetch = async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({
      done: true,
      message: { content: JSON.stringify({ clips: [pick()] }) },
      prompt_eval_count: 10,
      eval_count: 20,
    });
  };
  const request = makeRequest(
    transcript.segments.map((s, id) => ({ ...s, id })),
    config,
  );
  const result = await new OllamaProvider(
    'http://localhost:11434',
    transport,
  ).generate(request);
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 20 });
  assert.equal(sent.stream, false);
  assert.ok(sent.format);
  assert.equal(
    (sent.options as Record<string, unknown>).num_predict,
    config.maxOutputTokens,
  );
  await assert.rejects(
    () =>
      new OllamaProvider(
        'http://localhost:11434',
        async () => new Response('', { status: 500 }),
      ).generate(request),
    /500/,
  );
  await assert.rejects(() =>
    new OllamaProvider('http://localhost:11434', async () =>
      Response.json({ message: {} }),
    ).generate(request),
  );
});
