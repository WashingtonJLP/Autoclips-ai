import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, OpenAiProvider } from '../src/selection/provider';
import { readSelectionConfig } from '../src/selection/contracts';
import {
  makeRequest,
  SelectionService,
  UsageLedger,
} from '../src/selection/service';
import { Discovery } from '../src/discovery';
import {
  encryptTokens,
  decryptTokens,
  YouTubeUpload,
  Publishing,
} from '../src/publication';
import { equalSecret } from '../src/security';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';

const env = {
  LLM_PROVIDER: 'openai',
  LLM_MODEL: 'modelo-teste',
  LLM_ALLOW_EXTERNAL: 'true',
  LLM_ALLOW_PAID: 'true',
  OPENAI_API_KEY: 'chave-ficticia',
  LLM_INPUT_USD_PER_MILLION: '1',
  LLM_OUTPUT_USD_PER_MILLION: '2',
};
const config = readSelectionConfig(env);
test('IA paga bloqueada sem autorização, credencial, modelo e preços', () => {
  for (const overrides of [
    { LLM_ALLOW_PAID: 'false' },
    { OPENAI_API_KEY: '' },
    { LLM_INPUT_USD_PER_MILLION: '' },
    { LLM_MODEL: 'mock-v1' },
    { LLM_ALLOW_EXTERNAL: 'false' },
  ])
    assert.throws(() => createProvider(config, { ...env, ...overrides }));
  assert.equal(createProvider(readSelectionConfig({}), {}).simulated, true);
});
test('adaptador OpenAI envia schema/limites e contabiliza consumo sem rede', async () => {
  let calls = 0;
  const provider = new OpenAiProvider(env, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(String(options?.body));
    assert.equal(body.max_completion_tokens, config.maxOutputTokens);
    assert.equal(body.store, false);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.response_format.json_schema.schema.$schema, undefined);
    return Response.json({
      choices: [
        { finish_reason: 'stop', message: { content: '{"clips":[]}' } },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    });
  });
  const request = makeRequest(
    [{ id: 0, start: 0, end: 10, text: 'Uma ideia completa para um teste.' }],
    config,
  );
  assert.equal((await provider.generate(request)).usage?.costMicros, 40);
  const ledger: UsageLedger = {
    reserve: async () => ({}),
    settle: async () => {},
    fail: async () => {},
  };
  await assert.rejects(
    () =>
      new SelectionService(provider, ledger, config).select('t', {
        duration: 10,
        segments: request.segments,
      }),
    /Orçamento/,
  );
  assert.equal(
    calls,
    1,
    'Orçamento zero deve bloquear a segunda chamada antes do transporte',
  );
});
test('manifesto autorizado descobre permissão expressa e rejeita referências externas', async () => {
  let calls = 0;
  const discovery = new Discovery(
    async () => {
      calls++;
      return Response.json({
        items: [
          {
            id: 'test',
            name: 'Teste autorizado',
            url: 'https://example.org/video',
            license: 'PERMISSION',
            evidenceUrl: 'https://example.org/rights',
            attribution: 'Autor: teste autorizado',
            mediaUrl: 'https://example.org/test.mp4',
          },
        ],
      });
    },
    { SOURCE_MANIFEST_URLS: '["https://example.org/catalog.json"]' },
  );
  const found = await discovery.search('manifest', 'Teste');
  assert.equal(found.length, 1);
  assert.equal(
    (await discovery.resolve('manifest', found[0].reference)).connectorKey
      .length,
    64,
  );
  await assert.rejects(() =>
    discovery.resolve('manifest', 'https://evil.invalid/#test'),
  );
  assert.equal(calls, 3);
});
test('tokens cifrados autenticados, segredo comparado e publicação bloqueada', async () => {
  const key = 'ab'.repeat(32),
    encrypted = encryptTokens({ access_token: 'segredo' }, key);
  assert.ok(!encrypted.includes('segredo'));
  assert.deepEqual(decryptTokens(encrypted, key), { access_token: 'segredo' });
  assert.throws(() => decryptTokens(encrypted, 'cd'.repeat(32)));
  assert.equal(equalSecret('abc', 'abcd'), false);
  await assert.rejects(
    () =>
      new YouTubeUpload(async () => {
        throw new Error('Não deve chamar');
      }).upload(
        'fake',
        { title: 'Teste', description: 'Teste' },
        new Uint8Array(),
        false,
      ),
    /desativada/,
  );
});
test('OAuth usa PKCE, expiração, estado de uso único e cifra tokens sem vazar resposta', async () => {
  const store = new Map<string, string>();
  const queue = {
    getBackend: () => ({
      client: Promise.resolve({
        set: async (key: string, value: string, options: { EX: number }) => {
          assert.equal(options.EX, 600);
          store.set(key, value);
        },
        defineCommand: () => {},
        runCommand: async (_name: string, [key]: string[]) => {
          const value = store.get(key);
          store.delete(key);
          return value;
        },
      }),
    }),
  } as unknown as Queue;
  let stored = '';
  const db = {
    platformAccount: {
      findUnique: async () => null,
      upsert: async (input: { create: { encryptedTokens: string } }) => {
        stored = input.create.encryptedTokens;
      },
    },
  } as unknown as PrismaClient;
  const publishing = new Publishing(
    db,
    queue,
    {
      YOUTUBE_CLIENT_ID: 'id',
      YOUTUBE_CLIENT_SECRET: 'secret',
      YOUTUBE_REDIRECT_URI: 'http://localhost:3100/oauth/youtube',
      PLATFORM_TOKEN_KEY: 'ab'.repeat(32),
    },
    async (_url, options) => {
      assert.match(String(options?.body), /code_verifier=/);
      return Response.json({
        access_token: 'secreto',
        refresh_token: 'renovar',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/youtube.upload',
      });
    },
  );
  const start = new URL((await publishing.start({ platform: 'youtube' })).url);
  assert.equal(start.searchParams.get('code_challenge_method'), 'S256');
  const body = {
    platform: 'youtube',
    state: start.searchParams.get('state'),
    code: 'fake-code',
  };
  const result = await publishing.callback(body);
  assert.equal(result.publishing, 'simulation');
  assert.ok(stored && !stored.includes('secreto'));
  await assert.rejects(() => publishing.callback(body), /já utilizado/);
});

test('upload YouTube usa sessão oficial e MP4 privado com transporte falso', async () => {
  const previous = process.env.PUBLISH_ALLOW_REAL;
  process.env.PUBLISH_ALLOW_REAL = 'true';
  const requests: { url: string; method: string | undefined }[] = [];
  try {
    const uploader = new YouTubeUpload(async (url, options) => {
      requests.push({ url: String(url), method: options?.method });
      if (requests.length === 1) {
        assert.equal(
          JSON.parse(String(options?.body)).status.privacyStatus,
          'private',
        );
        return new Response(null, {
          status: 200,
          headers: {
            Location:
              'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fake',
          },
        });
      }
      assert.deepEqual(options?.body, Buffer.from([1, 2, 3]));
      return Response.json({ id: 'video-ficticio' });
    });
    assert.equal(
      (
        await uploader.upload(
          'token-ficticio',
          { title: 'Teste', description: 'Descrição' },
          new Uint8Array([1, 2, 3]),
          true,
        )
      ).id,
      'video-ficticio',
    );
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[1].method, 'PUT');
  } finally {
    if (previous === undefined) delete process.env.PUBLISH_ALLOW_REAL;
    else process.env.PUBLISH_ALLOW_REAL = previous;
  }
});

test('renovação OAuth sob demanda preserva refresh token e não retorna credenciais', async () => {
  const key = 'ab'.repeat(32);
  let stored = encryptTokens(
    {
      access_token: 'antigo',
      refresh_token: 'renovar',
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/youtube.upload',
    },
    key,
  );
  const db = {
    platformAccount: {
      findUnique: async () => ({ encryptedTokens: stored }),
      update: async (input: { data: { encryptedTokens: string } }) => {
        stored = input.data.encryptedTokens;
      },
    },
  } as unknown as PrismaClient;
  const publishing = new Publishing(
    db,
    {} as Queue,
    {
      YOUTUBE_CLIENT_ID: 'id',
      YOUTUBE_CLIENT_SECRET: 'secret',
      YOUTUBE_REDIRECT_URI: 'http://localhost:3100/oauth/youtube',
      PLATFORM_TOKEN_KEY: key,
    },
    async (_url, options) => {
      assert.match(String(options?.body), /grant_type=refresh_token/);
      return Response.json({ access_token: 'novo', expires_in: 3600 });
    },
  );
  const result = await publishing.refresh({ platform: 'youtube' });
  assert.deepEqual(result, {
    connected: true,
    platform: 'youtube',
    publishing: 'simulation',
  });
  assert.equal(
    (decryptTokens(stored, key) as { refresh_token: string }).refresh_token,
    'renovar',
  );
});
