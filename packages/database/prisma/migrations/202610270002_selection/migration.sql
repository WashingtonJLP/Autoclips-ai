ALTER TABLE "Task" ADD COLUMN "renderKey" TEXT;
ALTER TABLE "Task" ADD COLUMN "editorial" JSONB;
CREATE UNIQUE INDEX "Task_renderKey_key" ON "Task"("renderKey");
CREATE TABLE "LlmBudget" (
  "day" TEXT PRIMARY KEY,
  "tokens" BIGINT NOT NULL DEFAULT 0,
  "costMicros" BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE "LlmCall" (
  "key" TEXT PRIMARY KEY,
  "taskId" TEXT NOT NULL REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "day" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "inputReserved" INTEGER NOT NULL,
  "outputReserved" INTEGER NOT NULL,
  "costReservedMicros" INTEGER NOT NULL,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "costMicros" INTEGER,
  "state" TEXT NOT NULL DEFAULT 'RESERVED',
  "response" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "LlmCall_day_createdAt_idx" ON "LlmCall"("day", "createdAt");
CREATE INDEX "LlmCall_taskId_idx" ON "LlmCall"("taskId");
