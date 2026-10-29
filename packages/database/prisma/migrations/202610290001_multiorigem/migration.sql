CREATE TABLE "MediaAsset" (
 "id" TEXT PRIMARY KEY, "identity" TEXT NOT NULL UNIQUE, "platform" TEXT NOT NULL,
 "externalId" TEXT, "url" TEXT NOT NULL, "title" TEXT NOT NULL, "author" TEXT,
 "duration" DOUBLE PRECISION, "language" TEXT, "publishedAt" TIMESTAMP(3),
 "sourceId" TEXT, "mediaUrl" TEXT, "path" TEXT, "sha256" TEXT UNIQUE,
 "rightsConfirmed" BOOLEAN NOT NULL DEFAULT false, "accessible" BOOLEAN NOT NULL DEFAULT false,
 "reason" TEXT, "metadata" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "Automation" (
 "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT true, "intervalMinutes" INTEGER NOT NULL,
 "config" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "SearchRun" (
 "id" TEXT PRIMARY KEY, "automationId" TEXT NOT NULL REFERENCES "Automation"("id"),
 "status" TEXT NOT NULL DEFAULT 'PROCESSING', "found" INTEGER NOT NULL DEFAULT 0,
 "processed" INTEGER NOT NULL DEFAULT 0, "error" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3)
);
CREATE INDEX "SearchRun_automationId_createdAt_idx" ON "SearchRun"("automationId", "createdAt");
