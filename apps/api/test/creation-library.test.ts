import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { Production } from '../src/production';
import { Pipeline } from '../src/pipeline';
import { readSelectionConfig } from '../src/selection/contracts';
import { MockLlmProvider } from '../src/selection/provider';
import { chainIds } from '../src/library';

function setup(catalog = false) {
  const asset = {
    id: 'asset',
    identity: 'identity',
    title: 'Meu vídeo',
    url: 'https://example.org/own.mp4',
    mediaUrl: 'https://example.org/own.mp4',
    path: 'uploads/own.mp4',
    testContent: false,
    accessible: true,
    metadata: catalog
      ? {
          catalog: {
            license: 'CC0',
            evidenceUrl: 'https://example.org/license',
            attribution: 'Autor CC0',
          },
        }
      : {},
  };
  const sources: Record<string, unknown>[] = [];
  const queued: unknown[] = [];
  const p = {
    db: {
      mediaAsset: { findUnique: async () => asset, update: async () => asset },
      source: {
        findFirst: async () => sources[0] ?? null,
        findUnique: async () => sources[0] ?? null,
        upsert: async ({ create }: { create: Record<string, unknown> }) => {
          const source = { id: 'permission', ...create };
          sources.push(source);
          return source;
        },
      },
      task: {
        findFirst: async () => null,
        upsert: async ({ create }: { create: Record<string, unknown> }) => ({
          id: 'production',
          status: 'QUEUED',
          ...create,
        }),
      },
    },
    queue: {
      add: async (...args: unknown[]) => {
        queued.push(args);
      },
    },
    selection: {
      config: readSelectionConfig({}),
      provider: new MockLlmProvider(),
    },
  };
  return {
    production: new Production(p as unknown as Pipeline),
    sources,
    queued,
    asset,
  };
}
test('mídia nova pede uma confirmação específica e não exige cadastrar fonte', async () => {
  const { production, sources, queued } = setup();
  await assert.rejects(
    () => production.start({ assetId: 'asset' }),
    (e: BadRequestException) =>
      (e.getResponse() as { code: string }).code === 'AUTHORIZATION_REQUIRED',
  );
  assert.equal(sources.length, 0);
  assert.equal(queued.length, 0);
  const root = await production.start({
    assetId: 'asset',
    confirmPermission: true,
  });
  assert.equal(root.sourceId, 'permission');
  assert.equal(sources[0].purpose, 'media');
  assert.equal(sources[0].url, 'https://example.org/own.mp4');
  assert.equal(
    (sources[0].evidence as { method: string }).method,
    'operator-declaration',
  );
  await production.start({ assetId: 'asset' });
  assert.equal(sources.length, 1, 'Permissão válida é reutilizada');
});
test('licença de catálogo é registrada automaticamente e não amplia a origem autorizada', async () => {
  const { production, sources } = setup(true);
  await production.start({ assetId: 'asset' });
  assert.equal(sources[0].license, 'CC0');
  sources[0].url = 'https://example.org/outro.mp4';
  sources[0].mediaUrl = 'https://example.org/outro.mp4';
  await assert.rejects(
    () =>
      production.start({
        assetId: 'asset',
        sourceId: 'permission',
        confirmPermission: true,
      }),
    /outro vídeo/,
  );
});
test('upload sem fonte armazena o arquivo sem presumir autorização comercial', async () => {
  let created: Record<string, unknown> = {};
  const p = {
    db: {
      mediaAsset: {
        findUnique: async () => null,
        upsert: async ({ create }: { create: Record<string, unknown> }) => {
          created = create;
          return create;
        },
      },
    },
  };
  await new Production(p as unknown as Pipeline).registerUpload(
    undefined,
    { path: 'uploads/a.mp4', sha256: 'abc', duration: 12 },
    'meu-video.mp4',
    true,
  );
  assert.equal(created.title, 'meu-video.mp4');
  assert.equal(created.sourceId, undefined);
  assert.equal(created.rightsConfirmed, false);
  assert.equal(created.testContent, true);
});
test('cadeia de biblioteca alcança etapas compartilhadas sem confundi-las com propriedade', () => {
  const nodes = [
    { id: 'a', parentId: null, result: { reusedTaskId: 'shared' } },
    { id: 'b', parentId: null, result: null },
    { id: 'shared', parentId: 'b', result: null },
    { id: 'clip', parentId: 'shared', result: null },
  ];
  assert.deepEqual([...chainIds(nodes, 'a')].sort(), ['a', 'clip', 'shared']);
  assert.deepEqual([...chainIds(nodes, 'a', false)], ['a']);
  assert.deepEqual([...chainIds(nodes, 'b', false)].sort(), [
    'b',
    'clip',
    'shared',
  ]);
});
