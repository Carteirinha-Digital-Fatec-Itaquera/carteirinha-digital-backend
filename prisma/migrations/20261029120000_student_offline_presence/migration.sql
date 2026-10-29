CREATE TABLE "StudentOfflineSession" (
  "id" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "accountId" TEXT NOT NULL,
  "studentRa" TEXT NOT NULL, "origin" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentOfflineSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudentOfflineSession_tokenHash_key" ON "StudentOfflineSession"("tokenHash");
CREATE INDEX "StudentOfflineSession_accountId_expiresAt_idx" ON "StudentOfflineSession"("accountId", "expiresAt");
CREATE TABLE "StudentOfflineReceipt" (
  "id" TEXT NOT NULL, "accountId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL, "reference" TEXT NOT NULL, "scannedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "result" JSONB NOT NULL,
  CONSTRAINT "StudentOfflineReceipt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudentOfflineReceipt_accountId_requestId_key" ON "StudentOfflineReceipt"("accountId", "requestId");
CREATE INDEX "StudentOfflineReceipt_receivedAt_idx" ON "StudentOfflineReceipt"("receivedAt");
