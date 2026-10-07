-- CreateEnum
CREATE TYPE "ProjectContributorStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProjectCreditAuditAction" AS ENUM ('CREATED', 'UPDATED', 'DRAFT_SAVED', 'PUBLISHED', 'ARCHIVED', 'RESTORED', 'PHOTO_REPLACED', 'PHOTO_REMOVED');

-- CreateEnum
CREATE TYPE "ProjectCreditAssetStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProjectContributorLinkKind" AS ENUM ('GITHUB', 'LINKEDIN', 'EMAIL', 'EXTERNAL');

-- CreateTable
CREATE TABLE "ProjectContributor" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectContributorStatus" NOT NULL DEFAULT 'DRAFT',
    "draftVersion" INTEGER NOT NULL DEFAULT 1,
    "publishedVersion" INTEGER,
    "publishedSnapshot" JSONB,
    "photoUrl" TEXT,
    "photoStorageKey" TEXT,
    "photoPendingKey" TEXT,
    "photoConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "profileConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "archiveReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectContributor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectContributionParticipation" (
    "id" TEXT NOT NULL,
    "contributorId" TEXT NOT NULL,
    "semester" TEXT NOT NULL,
    "course" TEXT,
    "roles" TEXT[],
    "contribution" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectContributionParticipation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectContributorLink" (
    "id" TEXT NOT NULL,
    "contributorId" TEXT NOT NULL,
    "kind" "ProjectContributorLinkKind" NOT NULL DEFAULT 'EXTERNAL',
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectContributorLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCreditAudit" (
    "id" TEXT NOT NULL,
    "contributorId" TEXT NOT NULL,
    "action" "ProjectCreditAuditAction" NOT NULL,
    "performedBySecretaryId" INTEGER,
    "performedByName" TEXT,
    "beforeSnapshot" JSONB,
    "afterSnapshot" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectCreditAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCreditAssetCleanup" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'CREDITS_PHOTO',
    "status" "ProjectCreditAssetStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCreditAssetCleanup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectContributor_slug_key" ON "ProjectContributor"("slug");

-- CreateIndex
CREATE INDEX "ProjectContributor_status_idx" ON "ProjectContributor"("status");

-- CreateIndex
CREATE INDEX "ProjectContributor_name_idx" ON "ProjectContributor"("name");

-- CreateIndex
CREATE INDEX "ProjectContributionParticipation_contributorId_idx" ON "ProjectContributionParticipation"("contributorId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectContributionParticipation_contributorId_semester_key" ON "ProjectContributionParticipation"("contributorId", "semester");

-- CreateIndex
CREATE INDEX "ProjectContributorLink_contributorId_idx" ON "ProjectContributorLink"("contributorId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectContributorLink_contributorId_url_key" ON "ProjectContributorLink"("contributorId", "url");

-- CreateIndex
CREATE INDEX "ProjectCreditAudit_contributorId_idx" ON "ProjectCreditAudit"("contributorId");

-- CreateIndex
CREATE INDEX "ProjectCreditAudit_performedBySecretaryId_idx" ON "ProjectCreditAudit"("performedBySecretaryId");

-- CreateIndex
CREATE INDEX "ProjectCreditAssetCleanup_status_scheduledFor_idx" ON "ProjectCreditAssetCleanup"("status", "scheduledFor");

-- AddForeignKey
ALTER TABLE "ProjectContributionParticipation" ADD CONSTRAINT "ProjectContributionParticipation_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "ProjectContributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectContributorLink" ADD CONSTRAINT "ProjectContributorLink_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "ProjectContributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCreditAudit" ADD CONSTRAINT "ProjectCreditAudit_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "ProjectContributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCreditAudit" ADD CONSTRAINT "ProjectCreditAudit_performedBySecretaryId_fkey" FOREIGN KEY ("performedBySecretaryId") REFERENCES "Secretary"("id") ON DELETE SET NULL ON UPDATE CASCADE;
