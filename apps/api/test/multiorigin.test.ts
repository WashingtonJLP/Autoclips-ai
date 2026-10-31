import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizedUrl,
  Connectors,
  hash,
  isoDuration,
  VimeoConnector,
} from '../src/connectors';
import { productionOptions, Production, sameResource } from '../src/production';
import { searchConfig, automationSchema } from '../src/automation';
import { GeminiProvider } from '../src/selection/provider';
import { Pipeline } from '../src/pipeline';
import { Task } from '@prisma/client';

test('URLs normalizadas conservam identidade, rejeitam credenciais e plataformas desconhecidas', async () => {
  assert.equal(
    normalizedUrl('https://example.org/a.mp4?b=2&utm_source=x&a=1#t=20').href,
    'https://example.org/a.mp4?a=1&b=2',
  );
  for (const url of [
    'http://example.org/a',
    'file:///a',
    'https://user:pass@example.org/a',
    'https://example.org:8080/a',
  ])
    assert.throws(() => normalizedUrl(url));
  assert.throws(() => new Connectors().resolve('https://evil.invalid/private'));
  assert.equal(hash(['youtube', 'id']), hash(['youtube', 'id']));
  assert.equal(isoDuration('PT1H2M3S'), 3723);
});
test('políticas limitam frequência, quantidade, duração e plataformas', () => {
  assert.equal(productionOptions.parse({}).maxClips, 3);
  assert.throws(() =>
    productionOptions.parse({ minDuration: 50, maxDuration: 30 }),
  );
  assert.throws(() =>
    automationSchema.parse({
      name: 'Teste',
      kind: 'topic',
      intervalMinutes: 1,
      config: { platforms: ['youtube'], keywords: 'ciência' },
    }),
  );
  assert.throws(() =>
    searchConfig.parse({ platforms: ['inventada'], keywords: 'teste' }),
  );
  assert.equal(
    searchConfig.parse({ platforms: ['youtube'], keywords: 'IA' }).autoProcess,
    false,
  );
});
test('autorização compara o mesmo vídeo sem confundir canais ou outros arquivos', () => {
  assert.equal(
    sameResource(
      'https://youtu.be/abcdefghijk?t=30',
      'https://www.youtube.com/watch?v=abcdefghijk',
    ),
    true,
  );
  assert.equal(
    sameResource('https://example.org/a.mp4', 'https://example.org/b.mp4'),
    false,
  );
});
test('transcrição sem fala encerra continuação com causa real e não chama seleção', async () => {
  let update: unknown;
  const p = {
    db: {
      task: {
        findUnique: async () => null,
        update: async (v: unknown) => {
          update = v;
        },
      },
    },
    selection: {
      enqueue: () => {
        throw Error('Seleção não deve iniciar');
      },
    },
  };
  await Pipeline.prototype.continueTask.call(
    p as unknown as Pipeline,
    {
      id: 'empty',
      autoRun: true,
      status: 'COMPLETED',
      operation: 'transcribe',
      result: { segments: [] },
    } as unknown as Task,
  );
  assert.match(JSON.stringify(update), /nenhuma fala/);
  assert.match(JSON.stringify(update), /"continuationDone":true/);
});
test('produção bloqueia mídia pública sem direitos e sem acesso autorizado', async () => {
  const asset = {
    id: 'a',
    url: 'https://www.youtube.com/watch?v=abcdefghijk',
    accessible: false,
    mediaUrl: null,
    metadata: {},
  };
  const p = {
    db: {
      mediaAsset: { findUnique: async () => asset },
      source: {
        findUnique: async () => ({
          url: asset.url,
          commercialUseVerified: true,
        }),
      },
    },
  };
  await assert.rejects(
    () =>
      new Production(p as unknown as Pipeline).start({
        assetId: 'a',
        sourceId: 's',
      }),
    /arquivo original/,
  );
});
test('Gemini exige escolha explícita da modalidade e usa schema oficial sem rede', async () => {
  const env = {
    LLM_ALLOW_EXTERNAL: 'true',
    GEMINI_API_KEY: 'ficticia',
    LLM_MODEL: 'gemini-teste',
  };
  assert.throws(() => new GeminiProvider(env), /nível gratuito/);
  let calls = 0;
  const provider = new GeminiProvider(
    { ...env, GEMINI_FREE_TIER_CONFIRMED: 'true' },
    async (url, options) => {
      calls++;
      assert.match(String(url), /generativelanguage.googleapis.com/);
      const body = JSON.parse(String(options?.body));
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      assert.ok(body.generationConfig.responseJsonSchema);
      return Response.json({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: '{"clips":[]}' }] },
          },
        ],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 5,
          thoughtsTokenCount: 2,
        },
      });
    },
  );
  const response = await provider.generate({
    model: env.LLM_MODEL,
    messages: [{ role: 'user', content: 'teste' }],
    segments: [],
    maxOutputTokens: 400,
    minDuration: 5,
    maxDuration: 60,
  });
  assert.equal(calls, 1);
  assert.equal(response.usage?.outputTokens, 7);
  assert.equal(response.usage?.costMicros, 0);
});
test('link removido retorna explicação útil em vez de indisponibilidade transitória', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{}', { status: 404 });
    await assert.rejects(
      () => new VimeoConnector().resolve(new URL('https://vimeo.com/1')),
      /não encontrado/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
