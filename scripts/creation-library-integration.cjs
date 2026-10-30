// Executar somente no container local: node scripts/creation-library-integration.cjs.
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const {
  library,
  removeItem,
  restoreItem,
} = require('../apps/api/dist/library');
const { Pipeline } = require('../apps/api/dist/pipeline');
const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    application_name: 'creation-library-tests',
  }),
});
(async () => {
  const source = await db.source.create({
    data: {
      name: 'Teste isolado de exclusão',
      url: 'https://github.com/WashingtonJLP/Autoclips-ai',
      license: 'PERMISSION',
      evidenceUrl:
        'https://github.com/WashingtonJLP/Autoclips-ai/blob/main/scripts/create-fixture.ps1',
      attribution: 'Fixture sintética de contrato; nenhuma mídia de terceiros.',
      commercialUseVerified: true,
      verifiedAt: new Date(),
      purpose: 'media',
    },
  });
  const make = (
    operation,
    parentId = null,
    result = null,
    status = 'COMPLETED',
  ) =>
    db.task.create({
      data: {
        sourceId: source.id,
        operation,
        parentId,
        status,
        result: result ?? undefined,
        payload: { path: 'fixtures/creation-own-20261030.mp4' },
        testContent: true,
        continuationDone: true,
      },
    });
  const owner = await make('download');
  const transcript = await make('transcribe', owner.id, {
    duration: 10,
    segments: [{ start: 0, end: 10, text: 'Uma fala autorizada completa.' }],
  });
  const selection = await make('select', transcript.id);
  const clip = await make('clip', selection.id);
  const sibling = await make('clip', selection.id);
  const alias = await make('download', null, { reusedTaskId: transcript.id });
  const deleted = await removeItem(db, owner.id);
  assert.equal(
    (await db.task.findUnique({ where: { id: owner.id } })).deletedAt instanceof
      Date,
    true,
  );
  assert.equal(
    (await db.task.findUnique({ where: { id: transcript.id } })).deletedAt,
    null,
  );
  let snapshot = await library(db);
  assert.ok(!snapshot.productions.some((p) => p.id === owner.id));
  assert.ok(
    snapshot.productions
      .find((p) => p.id === alias.id)
      .clips.some((t) => t.id === clip.id),
  );
  const scheduled = await db.publication.create({
    data: {
      taskId: clip.id,
      platform: 'youtube',
      scheduledAt: new Date(Date.now() + 86400000),
    },
  });
  const removedClip = await removeItem(db, clip.id);
  assert.equal(
    (await db.task.findUnique({ where: { id: sibling.id } })).deletedAt,
    null,
  );
  assert.equal(
    (await db.publication.findUnique({ where: { id: scheduled.id } })).status,
    'CANCELLED',
  );
  await assert.rejects(() =>
    restoreItem(db, clip.id, new Date(0).toISOString()),
  );
  await restoreItem(db, clip.id, removedClip.undoToken);
  await restoreItem(db, owner.id, deleted.undoToken);
  const active = await make(
    'transcribe',
    null,
    {
      duration: 10,
      segments: [{ start: 0, end: 10, text: 'Uma fala autorizada completa.' }],
    },
    'PROCESSING',
  );
  await removeItem(db, active.id);
  const cancelled = await db.task.findUnique({ where: { id: active.id } });
  assert.equal(cancelled.status, 'CANCELLED');
  let advances = 0;
  await Pipeline.prototype.continueTask.call(
    {
      db,
      selection: {
        enqueue: async () => {
          advances++;
        },
      },
    },
    { ...active, autoRun: true, continuationDone: false, status: 'COMPLETED' },
  );
  assert.equal(advances, 0);
  await removeItem(db, alias.id);
  await removeItem(db, owner.id);
  console.log(
    JSON.stringify(
      {
        sharedStepsPreserved: true,
        sharedProductionPreserved: true,
        siblingPreserved: true,
        scheduledPublicationCancelled: true,
        undoScopeValidated: true,
        activeProductionCancelled: true,
        lateContinuationBlocked: true,
        testSource: source.id,
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
