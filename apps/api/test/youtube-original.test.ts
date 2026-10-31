import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Production, authorizedOriginalUrl } from '../src/production';
import { Pipeline } from '../src/pipeline';
import { hash } from '../src/connectors';
import { MockLlmProvider } from '../src/selection/provider';
import { readSelectionConfig } from '../src/selection/contracts';

function setup() {
  const youtube = {
    id: 'youtube',
    platform: 'youtube',
    identity: hash(['youtube', 'ACtest00001']),
    url: 'https://www.youtube.com/watch?v=ACtest00001',
    title: 'Referência de teste',
    author: 'Titular',
    metadata: {},
    path: null,
    mediaUrl: null,
    accessible: false,
    rightsConfirmed: false,
  };
  const rows = new Map<string, Record<string, unknown>>([
    ['youtube', youtube],
    [
      'file',
      {
        id: 'file',
        platform: 'upload',
        path: 'uploads/own.mp4',
        sha256: 'ab'.repeat(32),
        testContent: true,
        duration: 12,
        sourceId: 'unrelated',
        rightsConfirmed: false,
      },
    ],
  ]);
  let source: Record<string, unknown> | null = null,
    payload: Record<string, unknown> | undefined;
  const tx = {
    mediaAsset: {
      upsert: async ({ update }: { update: Record<string, unknown> }) => {
        const value = { ...rows.get('youtube'), ...update };
        rows.set('youtube', value);
        return value;
      },
      findUnique: async ({
        where,
      }: {
        where: { id?: string; identity?: string };
      }) =>
        where.id
          ? rows.get(where.id)
          : [...rows.values()].find((a) => a.identity === where.identity),
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const value = { ...rows.get(where.id), ...data };
        rows.set(where.id, value);
        return value;
      },
    },
    source: {
      upsert: async ({
        create,
        update,
      }: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        source = source
          ? { ...source, ...update }
          : { id: 'youtube-permission', ...create };
        return source;
      },
      findUnique: async () => source,
      findFirst: async () => source,
    },
    task: {
      findFirst: async () => null,
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        payload = create.payload as Record<string, unknown>;
        return { id: 'task', status: 'QUEUED', ...create };
      },
    },
  };
  const db = {
    ...tx,
    $transaction: async (fn: (tx: unknown) => unknown) => fn(tx),
  };
  const p = {
    db,
    selection: {
      config: readSelectionConfig({}),
      provider: new MockLlmProvider(),
    },
    queue: { add: async () => {} },
  };
  return {
    production: new Production(p as unknown as Pipeline),
    rows,
    get source() {
      return source;
    },
    get payload() {
      return payload;
    },
  };
}

test('original externo exige declaração específica e utiliza downloader existente, sem extrair YouTube', async () => {
  const ctx = setup();
  await assert.rejects(() =>
    ctx.production.linkOriginal('youtube', {
      mediaUrl: 'https://holder.example/own.mp4',
    }),
  );
  const result = await ctx.production.linkOriginal('youtube', {
    mediaUrl: 'https://holder.example/own.mp4',
    confirmPermission: true,
    evidenceUrl: 'https://holder.example/license',
  });
  assert.equal(result.availability.kind, 'available');
  assert.equal(result.platform, 'youtube');
  assert.equal(ctx.source?.url, 'https://www.youtube.com/watch?v=ACtest00001');
  assert.equal(ctx.source?.purpose, 'media');
  assert.equal(ctx.source?.evidenceUrl, 'https://holder.example/license');
  await ctx.production.start({ assetId: 'youtube' });
  assert.equal(ctx.payload?.url, 'https://holder.example/own.mp4');
  assert.equal(ctx.payload?.public_file_authorized, true);
  const again = await ctx.production.linkOriginal('youtube', {
    mediaUrl: 'https://holder.example/own.mp4',
    confirmPermission: true,
  });
  assert.equal(again.id, 'youtube');
  await assert.rejects(
    () =>
      ctx.production.linkOriginal('youtube', {
        mediaUrl: 'https://holder.example/other.mp4',
        confirmPermission: true,
      }),
    /não será substituído/,
  );
});

test('arquivo importado é associado por ID com permissão própria do vídeo, sem herdar direitos alheios', async () => {
  const ctx = setup();
  const result = await ctx.production.linkOriginal('youtube', {
    importedAssetId: 'file',
    confirmPermission: true,
  });
  assert.equal(result.availability.kind, 'imported');
  assert.equal(result.path, 'uploads/own.mp4');
  assert.equal(result.testContent, true);
  assert.equal(result.sourceId, 'youtube-permission');
  assert.notEqual(result.sourceId, 'unrelated');
  ctx.production.connectors.resolve = async () => {
    throw Error('Não consultar a rede');
  };
  const cached = await ctx.production.inspect({
    url: 'https://youtu.be/ACtest00001',
  });
  assert.equal(cached.id, 'youtube');
  await ctx.production.start({ assetId: 'youtube' });
  assert.equal(ctx.payload?.path, 'uploads/own.mp4');
  assert.equal(ctx.payload?.url, undefined);
});

test('vínculo externo persiste nas próximas análises sem consultar o YouTube', async () => {
  const ctx = setup();
  await ctx.production.linkOriginal('youtube', {
    mediaUrl: 'https://holder.example/own.webm',
    confirmPermission: true,
  });
  ctx.production.connectors.resolve = async () => {
    throw Error('Rede não deve ser consultada');
  };
  assert.equal(
    (await ctx.production.inspect({ url: 'https://youtu.be/ACtest00001' }))
      .availability.kind,
    'available',
  );
});

test('descoberta e atualização de metadados preservam o original autorizado', async () => {
  const ctx = setup();
  await ctx.production.linkOriginal('youtube', {
    mediaUrl: 'https://holder.example/own.mp4',
    confirmPermission: true,
  });
  await ctx.production.remember({
    platform: 'youtube',
    identity: hash(['youtube', 'ACtest00001']),
    externalId: 'ACtest00001',
    url: 'https://www.youtube.com/watch?v=ACtest00001',
    title: 'Título atualizado',
    accessible: false,
    rightsConfirmed: false,
    metadata: {
      thumbnailUrl: 'https://i.ytimg.com/vi/ACtest00001/hqdefault.jpg',
    },
  });
  const stored = ctx.rows.get('youtube')!;
  assert.equal(
    (stored.metadata as { authorizedOriginal: { method: string } })
      .authorizedOriginal.method,
    'rights-holder-url',
  );
  assert.equal(stored.title, 'Título atualizado');
  assert.equal(stored.accessible, true);
  await ctx.production.start({ assetId: 'youtube' });
  assert.equal(ctx.payload?.public_file_authorized, true);
});

test('páginas, transmissões YouTube, declarações inválidas e IDs sem arquivo são recusados', async () => {
  for (const value of [
    'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    'https://r1.googlevideo.com/stream.mp4',
    'https://youtube.com/own.mp4',
    'http://holder.example/own.mp4',
    'https://user:pass@holder.example/own.mp4',
    'https://holder.example:8443/own.mp4',
    'https://holder.example/player',
  ])
    assert.throws(() => authorizedOriginalUrl(value));
  assert.equal(
    authorizedOriginalUrl('https://holder.example/own.mov'),
    'https://holder.example/own.mov',
  );
  const ctx = setup();
  await assert.rejects(
    () =>
      ctx.production.linkOriginal('youtube', {
        importedAssetId: 'missing',
        confirmPermission: true,
      }),
    /já foi importado/,
  );
  await assert.rejects(
    () =>
      ctx.production.linkOriginal('file', {
        importedAssetId: 'file',
        confirmPermission: true,
      }),
    /YouTube/,
  );
  await assert.rejects(() =>
    ctx.production.linkOriginal('youtube', {
      mediaUrl: 'https://holder.example/a.mp4',
      importedAssetId: 'file',
      confirmPermission: true,
    }),
  );
});
