// Somente leitura. Executar no container API via stdin; não exporta credenciais.
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 }),
});
(async () => {
  const snapshot = {};
  for (const table of [
    'source',
    'task',
    'mediaAsset',
    'automation',
    'searchRun',
    'publication',
    'platformAccount',
  ])
    snapshot[table] = await db[table].findMany({
      select: table === 'platformAccount' ? { platform: true } : { id: true },
    });
  snapshot.mediaFiles = await db.mediaAsset.findMany({
    where: { path: { not: null } },
    select: { id: true, path: true, sha256: true },
  });
  console.log(JSON.stringify(snapshot));
})().finally(() => db.$disconnect());
