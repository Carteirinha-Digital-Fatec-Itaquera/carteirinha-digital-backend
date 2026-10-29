-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_STUDENT', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('DATA', 'PHOTO_CARD', 'EVENT', 'CERTIFICATE', 'ACCESS', 'OTHER');

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "ownerIdentity" TEXT NOT NULL,
    "ownerAccountId" TEXT,
    "category" "SupportCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "requestedField" TEXT,
    "proposedValue" TEXT,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "assignedSecretaryId" INTEGER,
    "eventId" TEXT,
    "certificateId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "studentReadVersion" INTEGER NOT NULL DEFAULT 1,
    "secretaryReadVersion" INTEGER NOT NULL DEFAULT 0,
    "lastActorRole" TEXT NOT NULL DEFAULT 'STUDENT',
    "closeReason" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "clientMessageId" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "authorIdentity" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "redactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAudit" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorIdentity" TEXT NOT NULL,
    "previousStatus" "SupportStatus",
    "nextStatus" "SupportStatus",
    "previousAssigneeId" INTEGER,
    "nextAssigneeId" INTEGER,
    "reason" TEXT,
    "resultReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_protocol_key" ON "SupportTicket"("protocol");

-- CreateIndex
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_ownerAccountId_createdAt_idx" ON "SupportTicket"("ownerAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_assignedSecretaryId_status_idx" ON "SupportTicket"("assignedSecretaryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_ownerIdentity_requestId_key" ON "SupportTicket"("ownerIdentity", "requestId");

-- CreateIndex
CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportMessage_authorIdentity_createdAt_idx" ON "SupportMessage"("authorIdentity", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessage_ticketId_clientMessageId_key" ON "SupportMessage"("ticketId", "clientMessageId");

-- CreateIndex
CREATE INDEX "SupportAudit_ticketId_createdAt_idx" ON "SupportAudit"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportAudit_ticketId_requestId_key" ON "SupportAudit"("ticketId", "requestId");

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_ownerAccountId_fkey" FOREIGN KEY ("ownerAccountId") REFERENCES "Student"("accountId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedSecretaryId_fkey" FOREIGN KEY ("assignedSecretaryId") REFERENCES "Secretary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "Certificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAudit" ADD CONSTRAINT "SupportAudit_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
