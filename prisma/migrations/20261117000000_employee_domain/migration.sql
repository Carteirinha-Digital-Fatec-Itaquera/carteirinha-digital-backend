-- CreateEnum
CREATE TYPE "EmployeeAccountStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EmployeePhotoProcessingState" AS ENUM ('UPLOADING', 'READY', 'FAILED', 'DELETE_PENDING', 'DELETED');

-- CreateEnum
CREATE TYPE "EmployeeAccessTokenPurpose" AS ENUM ('ACTIVATE', 'RESET_PASSWORD');

-- CreateEnum
CREATE TYPE "EmployeeTokenDeliveryState" AS ENUM ('PENDING', 'ACCEPTED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EmployeeImportMode" AS ENUM ('CREATE_ONLY', 'UPDATE');

-- CreateEnum
CREATE TYPE "EmployeeImportBatchState" AS ENUM ('ANALYZED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EmployeeImportRowDecision" AS ENUM ('READY_CREATE', 'READY_UPDATE', 'EXISTS', 'INVALID', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "EmployeeImportRowState" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'STALE');

-- AlterTable
ALTER TABLE "EventParticipant" ADD COLUMN     "employeeAccountId" TEXT;

-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "ownerEmployeeAccountId" TEXT;

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "socialName" TEXT,
    "searchText" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "rg" TEXT,
    "admissionDate" DATE NOT NULL,
    "accountStatus" "EmployeeAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "passwordHash" TEXT,
    "authVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "qrcode" TEXT NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsOn" DATE,
    "validUntil" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "endedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePhoto" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "reviewStatus" "PhotoStatus" NOT NULL DEFAULT 'PENDING',
    "processingState" "EmployeePhotoProcessingState" NOT NULL DEFAULT 'UPLOADING',
    "currentApproved" BOOLEAN NOT NULL DEFAULT false,
    "currentPending" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT,
    "approvedById" INTEGER,
    "reviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextCleanupAt" TIMESTAMP(3),

    CONSTRAINT "EmployeePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAccessToken" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "EmployeeAccessTokenPurpose" NOT NULL,
    "authVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "deliveryState" "EmployeeTokenDeliveryState" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeImportBatch" (
    "id" TEXT NOT NULL,
    "secretaryId" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT '1.0',
    "mode" "EmployeeImportMode" NOT NULL DEFAULT 'CREATE_ONLY',
    "state" "EmployeeImportBatchState" NOT NULL DEFAULT 'ANALYZED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "reviewDigest" TEXT NOT NULL,
    "requestId" TEXT,
    "counts" JSONB NOT NULL,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "EmployeeImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "groupKey" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "decision" "EmployeeImportRowDecision" NOT NULL,
    "state" "EmployeeImportRowState" NOT NULL DEFAULT 'PENDING',
    "employeeId" TEXT,
    "expectedEmployeeVersion" INTEGER,
    "operationKey" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "EmployeeImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAudit" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT,
    "actorRole" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "reason" TEXT,
    "changedFields" JSONB NOT NULL,
    "sourceImportBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeOfflineSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "authVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeOfflineSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeOfflineReceipt" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" JSONB NOT NULL,

    CONSTRAINT "EmployeeOfflineReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_accountId_key" ON "Employee"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_registrationNumber_key" ON "Employee"("registrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_qrcode_key" ON "Employee"("qrcode");

-- CreateIndex
CREATE INDEX "Employee_accountStatus_archivedAt_idx" ON "Employee"("accountStatus", "archivedAt");

-- CreateIndex
CREATE INDEX "Employee_name_id_idx" ON "Employee"("name", "id");

-- CreateIndex
CREATE INDEX "EmployeeAssignment_employeeId_active_archivedAt_idx" ON "EmployeeAssignment"("employeeId", "active", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePhoto_storageKey_key" ON "EmployeePhoto"("storageKey");

-- CreateIndex
CREATE INDEX "EmployeePhoto_reviewStatus_processingState_createdAt_idx" ON "EmployeePhoto"("reviewStatus", "processingState", "createdAt");

-- CreateIndex
CREATE INDEX "EmployeePhoto_processingState_nextCleanupAt_idx" ON "EmployeePhoto"("processingState", "nextCleanupAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePhoto_employeeId_requestId_key" ON "EmployeePhoto"("employeeId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeAccessToken_tokenHash_key" ON "EmployeeAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmployeeAccessToken_employeeId_purpose_createdAt_idx" ON "EmployeeAccessToken"("employeeId", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "EmployeeAccessToken_expiresAt_idx" ON "EmployeeAccessToken"("expiresAt");

-- CreateIndex
CREATE INDEX "EmployeeImportBatch_secretaryId_createdAt_idx" ON "EmployeeImportBatch"("secretaryId", "createdAt");

-- CreateIndex
CREATE INDEX "EmployeeImportBatch_state_leaseUntil_idx" ON "EmployeeImportBatch"("state", "leaseUntil");

-- CreateIndex
CREATE INDEX "EmployeeImportBatch_expiresAt_idx" ON "EmployeeImportBatch"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeImportRow_operationKey_key" ON "EmployeeImportRow"("operationKey");

-- CreateIndex
CREATE INDEX "EmployeeImportRow_batchId_groupId_idx" ON "EmployeeImportRow"("batchId", "groupId");

-- CreateIndex
CREATE INDEX "EmployeeImportRow_batchId_state_idx" ON "EmployeeImportRow"("batchId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeImportRow_batchId_rowNumber_key" ON "EmployeeImportRow"("batchId", "rowNumber");

-- CreateIndex
CREATE INDEX "EmployeeAudit_employeeId_createdAt_idx" ON "EmployeeAudit"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "EmployeeAudit_sourceImportBatchId_idx" ON "EmployeeAudit"("sourceImportBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeOfflineSession_tokenHash_key" ON "EmployeeOfflineSession"("tokenHash");

-- CreateIndex
CREATE INDEX "EmployeeOfflineSession_accountId_expiresAt_idx" ON "EmployeeOfflineSession"("accountId", "expiresAt");

-- CreateIndex
CREATE INDEX "EmployeeOfflineReceipt_receivedAt_idx" ON "EmployeeOfflineReceipt"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeOfflineReceipt_accountId_requestId_key" ON "EmployeeOfflineReceipt"("accountId", "requestId");

-- CreateIndex
CREATE INDEX "EventParticipant_employeeAccountId_idx" ON "EventParticipant"("employeeAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipant_eventId_employeeAccountId_key" ON "EventParticipant"("eventId", "employeeAccountId");

-- CreateIndex
CREATE INDEX "SupportTicket_ownerEmployeeAccountId_createdAt_idx" ON "SupportTicket"("ownerEmployeeAccountId", "createdAt");

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_ownerEmployeeAccountId_fkey" FOREIGN KEY ("ownerEmployeeAccountId") REFERENCES "Employee"("accountId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_employeeAccountId_fkey" FOREIGN KEY ("employeeAccountId") REFERENCES "Employee"("accountId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePhoto" ADD CONSTRAINT "EmployeePhoto_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePhoto" ADD CONSTRAINT "EmployeePhoto_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Secretary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAccessToken" ADD CONSTRAINT "EmployeeAccessToken_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeImportBatch" ADD CONSTRAINT "EmployeeImportBatch_secretaryId_fkey" FOREIGN KEY ("secretaryId") REFERENCES "Secretary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeImportRow" ADD CONSTRAINT "EmployeeImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "EmployeeImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAudit" ADD CONSTRAINT "EmployeeAudit_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAudit" ADD CONSTRAINT "EmployeeAudit_sourceImportBatchId_fkey" FOREIGN KEY ("sourceImportBatchId") REFERENCES "EmployeeImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeOfflineSession" ADD CONSTRAINT "EmployeeOfflineSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Employee"("accountId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeOfflineReceipt" ADD CONSTRAINT "EmployeeOfflineReceipt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Employee"("accountId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique indexes for current approved / current pending photo per employee
CREATE UNIQUE INDEX "EmployeePhoto_one_current_approved_idx" ON "EmployeePhoto"("employeeId") WHERE "currentApproved" = true;
CREATE UNIQUE INDEX "EmployeePhoto_one_current_pending_idx" ON "EmployeePhoto"("employeeId") WHERE "currentPending" = true;

-- Check constraints for Employee domain integrity
ALTER TABLE "EmployeeAssignment"
  ADD CONSTRAINT "EmployeeAssignment_date_range_check"
  CHECK ("validUntil" IS NULL OR "startsOn" IS NULL OR "validUntil" >= "startsOn"),
  ADD CONSTRAINT "EmployeeAssignment_title_length_check"
  CHECK (char_length(btrim("title")) BETWEEN 2 AND 120);

ALTER TABLE "EmployeePhoto"
  ADD CONSTRAINT "EmployeePhoto_current_flags_ready_check"
  CHECK (("currentApproved" = false AND "currentPending" = false) OR "processingState" = 'READY'),
  ADD CONSTRAINT "EmployeePhoto_current_flags_exclusive_check"
  CHECK (NOT ("currentApproved" = true AND "currentPending" = true));

ALTER TABLE "EventParticipant"
  ADD CONSTRAINT "EventParticipant_employee_exclusive_check"
  CHECK (NOT ("employeeAccountId" IS NOT NULL AND ("accountId" IS NOT NULL OR "visitorId" IS NOT NULL)));

ALTER TABLE "SupportTicket"
  ADD CONSTRAINT "SupportTicket_owner_exclusive_check"
  CHECK (NOT ("ownerEmployeeAccountId" IS NOT NULL AND "ownerAccountId" IS NOT NULL));

