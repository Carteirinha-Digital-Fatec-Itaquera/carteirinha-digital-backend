CREATE TABLE "ManualCertificateOperation" (
 "requestId" TEXT PRIMARY KEY, "eventId" TEXT NOT NULL, "secretaryId" INTEGER NOT NULL,
 "payloadHash" TEXT NOT NULL, "certificateId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ManualCertificateOperation_eventId_secretaryId_idx" ON "ManualCertificateOperation"("eventId", "secretaryId");
