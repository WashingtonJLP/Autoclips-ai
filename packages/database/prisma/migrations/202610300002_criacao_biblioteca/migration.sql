ALTER TABLE "Source" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'monitoring';
ALTER TABLE "Task" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "testContent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MediaAsset" ADD COLUMN "testContent" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Source" SET "purpose" = 'media' WHERE "connectorKey" LIKE 'authorization-%';
UPDATE "Task" t SET "testContent" = true FROM "Source" s
WHERE t."sourceId" = s.id AND (t.payload->>'path' LIKE 'fixtures/%' OR s.attribution ~* '(sint.tic|fixture|System.Speech)');
UPDATE "MediaAsset" a SET "testContent" = true WHERE a.metadata->>'testContent' = 'true'
OR a.path LIKE 'fixtures/%' OR EXISTS (SELECT 1 FROM "Source" s WHERE s.id = a."sourceId" AND s.attribution ~* '(sint.tic|fixture|System.Speech)');
CREATE INDEX "Task_deletedAt_parentId_createdAt_idx" ON "Task"("deletedAt", "parentId", "createdAt");
