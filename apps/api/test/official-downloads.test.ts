import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VimeoConnector,
  TwitchConnector,
  identityForUrl,
} from '../src/connectors';
import { Production } from '../src/production';
import { Pipeline } from '../src/pipeline';

test('reanálise atualiza URL oficial expirada e disponibilidade, preservando arquivo importado', async () => {
  let imported = false;
  const updates: Record<string, unknown>[] = [];
  const transaction = {
    source: { findFirst: async () => null },
    mediaAsset: {
      findUnique: async () => ({
        metadata: {},
        path: imported ? 'uploads/own.mp4' : null,
      }),
      upsert: async (args: { update: Record<string, unknown> }) => {
        updates.push(args.update);
        return args.update;
      },
    },
  };
  const production = new Production({
    db: {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(transaction),
    },
  } as unknown as Pipeline);
  const candidate = {
    identity: 'test',
    platform: 'vimeo',
    url: 'https://vimeo.com/123',
    title: 'Próprio',
    mediaUrl: 'https://cdn.example.org/new-signed-file',
    accessible: true,
    rightsConfirmed: false,
    metadata: { acquisition: { method: 'vimeo-official', extension: 'mp4' } },
  };
  await production.remember(candidate);
  assert.equal(updates[0].mediaUrl, candidate.mediaUrl);
  assert.equal(updates[0].accessible, true);
  await production.remember({
    ...candidate,
    mediaUrl: undefined,
    accessible: false,
    metadata: {},
  });
  assert.equal(updates[1].mediaUrl, null);
  assert.equal(updates[1].accessible, false);
  imported = true;
  await production.remember(candidate);
  assert.equal(updates[2].mediaUrl, undefined);
  assert.equal(updates[2].accessible, undefined);
  assert.equal(updates[2].rightsConfirmed, undefined);
});

test('Vimeo só oferece arquivo progressivo disponibilizado pela API oficial', async () => {
  const previous = process.env.VIMEO_ACCESS_TOKEN,
    original = globalThis.fetch;
  process.env.VIMEO_ACCESS_TOKEN = 'test-only';
  try {
    let files: unknown[] = [
      {
        type: 'video/mp4',
        size: 1000,
        link: 'https://cdn.example.org/file?token=keep%2Bthis',
      },
    ];
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /^https:\/\/api.vimeo.com\/videos\/123\?/);
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        'Bearer test-only',
      );
      return Response.json({
        name: 'Próprio',
        user: { name: 'Autor' },
        duration: 20,
        download: files,
      });
    };
    const connector = new VimeoConnector(),
      url = new URL('https://vimeo.com/123');
    const candidate = await connector.resolve(url);
    assert.equal(candidate.accessible, true);
    assert.equal(candidate.rightsConfirmed, false);
    assert.equal(
      candidate.mediaUrl,
      'https://cdn.example.org/file?token=keep%2Bthis',
    );
    assert.deepEqual(candidate.metadata.acquisition, {
      method: 'vimeo-official',
      extension: 'mp4',
    });
    for (const file of [
      {
        type: 'application/x-mpegURL',
        size: 1000,
        link: 'https://cdn.example.org/hls.m3u8',
      },
      {
        type: 'video/mp4',
        size: 513 * 1024 ** 2,
        link: 'https://cdn.example.org/a.mp4',
      },
      { type: 'video/mp4', size: 1000, link: 'http://cdn.example.org/a.mp4' },
    ]) {
      files = [file];
      assert.equal((await connector.resolve(url)).accessible, false);
    }
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.VIMEO_ACCESS_TOKEN;
    else process.env.VIMEO_ACCESS_TOKEN = previous;
  }
});

test('Twitch usa download oficial de clips só com escopo e identidade válidos', async () => {
  const client = process.env.TWITCH_CLIENT_ID,
    token = process.env.TWITCH_ACCESS_TOKEN,
    original = globalThis.fetch;
  process.env.TWITCH_CLIENT_ID = 'test-client';
  process.env.TWITCH_ACCESS_TOKEN = 'test-only';
  try {
    let scopes: string[] = ['channel:manage:clips'],
      downloads = 0,
      denied = false;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/oauth2/validate'))
        return Response.json({
          client_id: 'test-client',
          user_id: '12',
          scopes,
        });
      if (url.includes('/clips/downloads')) {
        downloads++;
        assert.match(url, /editor_id=12/);
        assert.match(url, /broadcaster_id=12/);
        assert.match(url, /clip_id=OwnClip/);
        return denied
          ? new Response('', { status: 403 })
          : Response.json({
              data: [
                {
                  clip_id: 'OwnClip',
                  landscape_download_url: 'https://cdn.example.org/own.mp4',
                },
              ],
            });
      }
      assert.equal(url, 'https://api.twitch.tv/helix/clips?id=OwnClip');
      return Response.json({
        data: [
          {
            id: 'OwnClip',
            title: 'Próprio',
            broadcaster_name: 'Autor',
            broadcaster_id: '12',
            duration: 20,
          },
        ],
      });
    };
    const connector = new TwitchConnector(),
      url = new URL('https://clips.twitch.tv/OwnClip');
    const candidate = await connector.resolve(url);
    assert.equal(candidate.accessible, true);
    assert.equal(candidate.rightsConfirmed, false);
    assert.deepEqual(candidate.metadata.acquisition, {
      method: 'twitch-clips-official',
      extension: 'mp4',
    });
    assert.equal(
      identityForUrl(url.href),
      identityForUrl('https://www.twitch.tv/author/clip/OwnClip'),
    );
    assert.notEqual(
      identityForUrl(url.href),
      identityForUrl('https://www.twitch.tv/videos/123'),
    );
    scopes = [];
    assert.equal((await connector.resolve(url)).accessible, false);
    assert.equal(downloads, 1);
    scopes = ['editor:manage:clips'];
    denied = true;
    assert.equal((await connector.resolve(url)).accessible, false);
  } finally {
    globalThis.fetch = original;
    if (client === undefined) delete process.env.TWITCH_CLIENT_ID;
    else process.env.TWITCH_CLIENT_ID = client;
    if (token === undefined) delete process.env.TWITCH_ACCESS_TOKEN;
    else process.env.TWITCH_ACCESS_TOKEN = token;
  }
});
