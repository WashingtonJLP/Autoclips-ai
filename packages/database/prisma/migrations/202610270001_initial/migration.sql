CREATE TABLE "Source" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "license" TEXT NOT NULL,
  "evidenceUrl" TEXT NOT NULL,
  "attribution" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "commercialUseVerified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "Task" (
  "id" TEXT PRIMARY KEY,
  "sourceId" TEXT NOT NULL REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "operation" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "payload" JSONB NOT NULL,
  "result" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Task_status_createdAt_idx" ON "Task"("status", "createdAt");
