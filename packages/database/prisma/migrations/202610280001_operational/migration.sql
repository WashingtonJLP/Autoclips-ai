ALTER TABLE "Source" ADD COLUMN "connectorKey" TEXT, ADD COLUMN "mediaUrl" TEXT, ADD COLUMN "evidence" JSONB;
CREATE UNIQUE INDEX "Source_connectorKey_key" ON "Source"("connectorKey");
ALTER TABLE "Task" ADD COLUMN "autoRun" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "continuationDone" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "parentId" TEXT;
CREATE TABLE "PlatformAccount" (
  "platform" TEXT NOT NULL PRIMARY KEY, "encryptedTokens" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "Publication" (
  "id" TEXT NOT NULL PRIMARY KEY, "taskId" TEXT NOT NULL, "platform" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL, "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "result" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Publication_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Publication_taskId_platform_key" ON "Publication"("taskId", "platform");
