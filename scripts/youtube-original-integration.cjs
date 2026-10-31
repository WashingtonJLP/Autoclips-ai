// Referência sintética isolada; não publica nem consulta um vídeo fictício no YouTube.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { hash } = require('../apps/api/dist/connectors');
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 }),
});
const headers = {
  Authorization: 'Bearer ' + process.env.INTERNAL_API_TOKEN,
  'Content-Type': 'application/json',
};
async function api(path, body) {
  const r = await fetch('http://127.0.0.1:3001/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  assert.ok(r.ok, JSON.stringify(data));
  return data;
}
(async () => {
  assert.equal((await api('llm/config')).provider, 'mock');
  const file = await db.mediaAsset.findFirst({
    where: { platform: 'upload', testContent: true, path: { not: null } },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(file);
  const externalId = 'T' + randomBytes(5).toString('hex');
  const reference = await db.mediaAsset.create({
    data: {
      identity: hash(['youtube', externalId]),
      platform: 'youtube',
      externalId,
      url: 'https://www.youtube.com/watch?v=' + externalId,
      title: 'Referência sintética para validar original já importado',
      metadata: {
        fixture: true,
        note: 'Não representa nem consulta uma publicação real no YouTube.',
      },
      testContent: true,
    },
  });
  const linked = await api('media/' + reference.id + '/original', {
    importedAssetId: file.id,
    confirmPermission: true,
    evidenceUrl:
      'https://github.com/WashingtonJLP/Autoclips-ai/blob/main/scripts/create-fixture.ps1',
    attribution:
      'Fala sintética autorizada criada com System.Speech e FFmpeg para teste local.',
  });
  assert.equal(linked.path, file.path);
  assert.notEqual(linked.sourceId, file.sourceId);
  assert.equal(linked.availability.kind, 'imported');
  assert.equal(
    (await api('media/inspect', { url: reference.url })).id,
    reference.id,
  );
  const request = {
    assetId: reference.id,
    options: { maxClips: 1, minDuration: 5, maxDuration: 30, language: 'en' },
  };
  const root = await api('productions', request);
  assert.equal(root.operation, 'transcribe');
  let production;
  for (let i = 0; i < 120; i++) {
    production = (await api('library')).productions.find(
      (p) => p.id === root.id,
    );
    assert.ok(production);
    assert.notEqual(production.status, 'FAILED', production.error);
    if (
      production.status === 'COMPLETED' &&
      production.clips.some((c) => c.status === 'COMPLETED')
    )
      break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const clip = production.clips.find((c) => c.status === 'COMPLETED');
  assert.ok(clip);
  assert.equal(clip.result.quality.validated, true);
  assert.ok(!production.steps.some((s) => s.operation === 'download'));
  assert.equal((await api('productions', request)).id, root.id);
  console.log(
    JSON.stringify(
      {
        fixtureReference: reference.id,
        publishedYoutubeVideo: false,
        importedFile: file.id,
        production: root.id,
        clip: clip.id,
        reusedStoredPath: true,
        separatePermissionScope: true,
        noDownload: true,
        automaticCompletion: true,
        selection: 'mock',
        paidCalls: 0,
      },
      null,
      2,
    ),
  );
})()
  .finally(() => db.$disconnect())
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
