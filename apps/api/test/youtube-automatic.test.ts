import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Discovery } from '../src/discovery';
import { identityForUrl, YouTubeConnector } from '../src/connectors';
import { Production, sameResource } from '../src/production';
import { Pipeline } from '../src/pipeline';
import { youtubeVideoId } from '../src/youtube-url';

const id = 'D7k9RnSyrUw';
const variants = [
  `https://www.youtube.com/watch?v=${id}&t=10`,
  `https://youtu.be/${id}?si=tracking`,
  `https://youtube.com/shorts/${id}/`,
  `https://m.youtube.com/watch?v=${id}`,
  `https://www.youtube.com/embed/${id}`,
  `https://www.youtube-nocookie.com/embed/${id}`,
  `https://www.youtube.com/live/${id}`,
  `https://music.youtube.com/watch?v=${id}`,
];
function page() {
  return {
    title: 'File:Licensed.webm',
    imageinfo: [
      {
        url: 'https://upload.wikimedia.org/own.webm',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Licensed.webm',
        mime: 'video/webm',
        size: 10000,
        duration: 20,
        timestamp: '2026-01-01T00:00:00Z',
        sha1: 'ab'.repeat(20),
        extmetadata: {
          Artist: { value: 'Autor' },
          LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0' },
          Credit: {
            value: `<a href="https://www.youtube.com/watch?v=${id}&amp;t=12">Original</a>`,
          },
          Restrictions: { value: '' },
        },
      },
    ],
  };
}
function discovery(pages: unknown[], continuation?: unknown) {
  return new Discovery(async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://commons.wikimedia.org');
    assert.equal(
      url.searchParams.get('gsrsearch'),
      `insource:"${id}" filetype:video`,
    );
    assert.equal(url.searchParams.get('gsrlimit'), '6');
    assert.equal(init?.redirect, 'error');
    return Response.json({
      query: { pages: Object.fromEntries(pages.map((p, i) => [i, p])) },
      continue: continuation,
    });
  });
}

test('formatos YouTube compartilham identidade, permissão e original já importado sem rede', async () => {
  const asset = {
    id: 'known',
    platform: 'youtube',
    path: 'downloads/known.webm',
    accessible: true,
    rightsConfirmed: true,
    metadata: {},
  };
  const production = new Production({
    db: { mediaAsset: { findUnique: async () => asset } },
  } as unknown as Pipeline);
  production.connectors.resolve = async () => {
    throw Error('Não consultar a plataforma');
  };
  for (const url of variants) {
    assert.equal(youtubeVideoId(new URL(url)), id);
    assert.equal(identityForUrl(url), identityForUrl(variants[0]));
    assert.equal(sameResource(url, variants[0]), true);
    assert.equal(
      (await production.inspect({ url })).availability.kind,
      'imported',
    );
  }
  for (const url of [
    `https://youtube.com.evil.test/watch?v=${id}`,
    `https://evil.test/?url=https://youtu.be/${id}`,
    `https://www.youtube.com/channel/${id}`,
    `https://www.youtube.com/other?v=${id}`,
    `https://user:pass@youtube.com/watch?v=${id}`,
    `https://youtube.com:8443/watch?v=${id}`,
    `https://youtube.com:80/watch?v=${id}`,
  ])
    assert.equal(youtubeVideoId(new URL(url)), undefined);
});

test('descoberta aceita somente cópia licenciada única com origem YouTube exata', async () => {
  const result = await discovery([page()]).youtubeOriginal(id);
  assert.equal(result.status, 'found');
  assert.equal(result.candidate?.license, 'CC-BY-4.0');
  assert.match(result.candidate!.attribution, /Autor/);
  assert.equal(result.candidate!.evidence.sha1, 'ab'.repeat(20));
  assert.equal(
    (await discovery([page(), page()]).youtubeOriginal(id)).status,
    'ambiguous',
  );
  assert.equal(
    (await discovery([page()], { gsroffset: 6 }).youtubeOriginal(id)).status,
    'ambiguous',
  );
  // Continuação do histórico do arquivo não indica mais resultados de busca.
  assert.equal(
    (await discovery([page()], { iistart: 'old-revision' }).youtubeOriginal(id))
      .status,
    'found',
  );
});

test('erro de catálogo em HTTP 200 continua sendo falha de consulta', async () => {
  const catalog = new Discovery(async () =>
    Response.json({ error: { code: 'searchdisabled' } }),
  );
  await assert.rejects(
    () => catalog.youtubeOriginal(id),
    /consultar o catálogo/,
  );
});

test('busca/título/descrição não autorizam arquivos de outro vídeo, imagens ou licenças restritas', async () => {
  for (const mutate of [
    (p: ReturnType<typeof page>) => {
      p.imageinfo[0].extmetadata.Credit.value = `<a href="https://youtu.be/ABCDEFGHIJK">Outro</a>`;
    },
    (p: ReturnType<typeof page>) => {
      p.imageinfo[0].extmetadata.Credit.value = `https://youtu.be/${id}`;
    },
    (p: ReturnType<typeof page>) => {
      p.imageinfo[0].extmetadata.Credit.value = `<a data-href="https://youtu.be/${id}">Não é origem</a>`;
    },
    (p: ReturnType<typeof page>) => {
      p.imageinfo[0].extmetadata.Credit.value = `<a href="https://evil.test/redirect?url=https://youtu.be/${id}">Link</a>`;
    },
    (p: ReturnType<typeof page>) => {
      p.imageinfo[0].extmetadata.Credit.value +=
        '<a href="https://youtu.be/ABCDEFGHIJK">Outro</a>';
    },
    (p: ReturnType<typeof page>) => {
      p.imageinfo[0].mime = 'image/jpeg';
    },
    (p: ReturnType<typeof page>) => {
      p.imageinfo[0].extmetadata.LicenseUrl.value =
        'https://creativecommons.org/licenses/by-nc/4.0';
    },
    (p: ReturnType<typeof page>) => {
      p.imageinfo[0].extmetadata.Restrictions.value = 'restricted';
    },
    (p: ReturnType<typeof page>) => {
      p.imageinfo[0].sha1 = '';
    },
    (p: ReturnType<typeof page>) => {
      p.imageinfo[0].duration = 7201;
    },
    (p: ReturnType<typeof page>) => {
      p.imageinfo[0].size = 513 * 1024 ** 2;
    },
  ]) {
    const value = page();
    mutate(value);
    assert.equal(
      (await discovery([value]).youtubeOriginal(id)).status,
      'not_found',
    );
  }
});

test('conector preserva metadados YouTube e registra licença/versão sem confundir com íntegra', async () => {
  const original = globalThis.fetch,
    key = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  globalThis.fetch = async () =>
    Response.json({
      title: 'Original',
      author_name: 'Canal',
      thumbnail_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    });
  try {
    const asset = await new YouTubeConnector(discovery([page()])).resolve(
      new URL(variants[0]),
    );
    assert.equal(asset.accessible, true);
    assert.equal(asset.rightsConfirmed, false);
    assert.match(asset.title, /versão licenciada/);
    assert.equal(asset.duration, 20);
    assert.equal(asset.mediaUrl, 'https://upload.wikimedia.org/own.webm');
    assert.equal(
      (asset.metadata.youtubeMetadata as { title: string }).title,
      'Original',
    );
    assert.equal(asset.metadata.originalDiscovery, 'found');
    const unavailable = new Discovery(async () => {
      throw Error('Catálogo indisponível');
    });
    const blocked = await new YouTubeConnector(unavailable).resolve(
      new URL(variants[0]),
    );
    assert.equal(blocked.accessible, false);
    assert.equal(blocked.metadata.originalDiscovery, 'unavailable');
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = key;
  }
});
