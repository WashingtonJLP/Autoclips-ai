import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  identityForUrl,
  thumbnailUrl,
  YouTubeConnector,
  TwitchConnector,
  hash,
} from '../src/connectors';
import { Production, describeMedia } from '../src/production';
import { Pipeline } from '../src/pipeline';
import { Task } from '@prisma/client';

test('análise reutiliza original importado antes de consultar a plataforma', async () => {
  const imported = {
    id: 'a',
    platform: 'youtube',
    path: 'uploads/original.mp4',
    accessible: false,
    rightsConfirmed: true,
    metadata: {
      thumbnailUrl: 'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg',
    },
  };
  let query: unknown,
    network = 0;
  const p = {
    db: {
      mediaAsset: {
        findUnique: async (args: unknown) => {
          query = args;
          return imported;
        },
      },
    },
  };
  const production = new Production(p as unknown as Pipeline);
  production.connectors.resolve = async () => {
    network++;
    throw Error('Não consultar rede');
  };
  const result = await production.inspect({
    url: 'https://youtu.be/jNQXAC9IVRw?utm_source=test',
  });
  assert.equal(result.availability.kind, 'imported');
  assert.equal(network, 0);
  assert.deepEqual(query, {
    where: { identity: hash(['youtube', 'jNQXAC9IVRw']) },
  });
  assert.equal(
    identityForUrl('https://www.youtube.com/watch?v=jNQXAC9IVRw'),
    identityForUrl('https://youtu.be/jNQXAC9IVRw'),
  );
  assert.equal(
    identityForUrl('https://www.twitch.tv/videos/123'),
    hash(['twitch', '123']),
  );
});

test('YouTube apresenta miniatura e mensagem curta sem sugerir extração nem expor configuração', async () => {
  const original = globalThis.fetch,
    key = process.env.YOUTUBE_API_KEY;
  try {
    delete process.env.YOUTUBE_API_KEY;
    globalThis.fetch = async () =>
      Response.json({
        title: 'Meu vídeo',
        author_name: 'Meu canal',
        thumbnail_url: 'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg',
      });
    const result = describeMedia(
      await new YouTubeConnector().resolve(
        new URL('https://youtu.be/jNQXAC9IVRw'),
      ),
    );
    assert.equal(result.title, 'Meu vídeo');
    assert.equal(result.author, 'Meu canal');
    assert.ok(result.thumbnailUrl);
    assert.equal(result.availability.kind, 'upload_required');
    assert.ok(!result.reason?.includes('YOUTUBE_API_KEY'));
    assert.match(result.availability.message, /original autorizado/);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = key;
  }
});

test('Twitch sem conexão continua identificado e oferece alternativa sem chamada de rede', async () => {
  const client = process.env.TWITCH_CLIENT_ID,
    token = process.env.TWITCH_ACCESS_TOKEN;
  try {
    delete process.env.TWITCH_CLIENT_ID;
    delete process.env.TWITCH_ACCESS_TOKEN;
    const result = describeMedia(
      await new TwitchConnector().resolve(
        new URL('https://www.twitch.tv/videos/123'),
      ),
    );
    assert.equal(result.platform, 'twitch');
    assert.equal(result.availability.kind, 'upload_required');
    assert.match(result.availability.message, /conexão.*não está configurada/);
    assert.ok(!result.availability.message.includes('TWITCH_'));
  } finally {
    if (client !== undefined) process.env.TWITCH_CLIENT_ID = client;
    if (token !== undefined) process.env.TWITCH_ACCESS_TOKEN = token;
  }
});

test('disponibilidade separa mídia de autorização e miniaturas rejeitam URLs não confiáveis', () => {
  const base = {
    platform: 'direct',
    accessible: true,
    rightsConfirmed: false,
    metadata: {},
  };
  assert.equal(describeMedia(base).availability.kind, 'permission_required');
  assert.equal(
    describeMedia({ ...base, rightsConfirmed: true }).availability.kind,
    'available',
  );
  assert.equal(
    describeMedia({ ...base, metadata: { catalog: { license: 'CC0' } } })
      .availability.kind,
    'available',
  );
  for (const url of [
    'http://i.ytimg.com/a',
    'https://localhost/a',
    'https://user:pass@i.ytimg.com/a',
    'data:image/png;base64,abc',
  ])
    assert.equal(thumbnailUrl(url), undefined);
});

test('importação reutiliza caminho e duração do mesmo arquivo sem copiar direitos de outra mídia', async () => {
  let update: { data: Record<string, unknown> } | undefined;
  const p = {
    db: {
      task: {
        findUnique: async () => null,
        upsert: async () => ({
          id: 'next',
          parentId: 'download',
          status: 'COMPLETED',
          continuationDone: true,
        }),
        update: async () => {},
      },
      mediaAsset: {
        findUnique: async () => ({
          path: 'uploads/existing.mp4',
          duration: 12,
        }),
        update: async (value: { data: Record<string, unknown> }) => {
          update = value;
        },
      },
    },
    selection: { config: {} },
    production: { findTranscript: async () => null },
    queue: { add: async () => {} },
  };
  await Pipeline.prototype.continueTask.call(
    p as unknown as Pipeline,
    {
      id: 'download',
      sourceId: 's',
      operation: 'download',
      status: 'COMPLETED',
      autoRun: true,
      continuationDone: false,
      result: { path: 'downloads/new.mp4', sha256: 'ab'.repeat(32) },
      editorial: { assetId: 'asset' },
    } as unknown as Task,
  );
  assert.equal(update?.data.path, 'uploads/existing.mp4');
  assert.equal(update?.data.duration, 12);
  assert.equal(update?.data.rightsConfirmed, undefined);
  assert.equal(update?.data.sourceId, undefined);
});
