-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "certificatePolicies" JSONB,
ADD COLUMN     "geoPolicy" JSONB,
ADD COLUMN     "organizerCourse" TEXT,
ADD COLUMN     "promoter" TEXT,
ADD COLUMN     "seriesId" TEXT,
ADD COLUMN     "visitorsAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "windowMinutes" INTEGER;

-- AlterTable
ALTER TABLE "EventCheckpoint" ADD COLUMN     "closesAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "evidence" JSONB,
ADD COLUMN     "participantId" TEXT,
ALTER COLUMN "studentRa" DROP NOT NULL,
ALTER COLUMN "studentAccountId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN     "participantId" TEXT,
ALTER COLUMN "studentRa" DROP NOT NULL,
ALTER COLUMN "studentAccountId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "EventSeries" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "retentionAt" TIMESTAMP(3) NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "cpfRequired" BOOLEAN NOT NULL DEFAULT false,
    "courses" TEXT[],
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorRegistration" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "emailHash" TEXT,
    "course" TEXT,
    "cpfHash" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastChallengeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitorRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitorSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventParticipant" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "visitorId" TEXT,
    "accountId" TEXT,
    "name" TEXT NOT NULL,
    "course" TEXT,
    "role" TEXT NOT NULL DEFAULT 'ATTENDEE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificateTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertificateTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificateSigner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "course" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "assetId" TEXT NOT NULL,
    "authorizedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertificateSigner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAsset" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificateArtifact" (
    "id" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING_RENDER',
    "storageKey" TEXT,
    "sha256" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "deliveryState" TEXT NOT NULL DEFAULT 'PENDING',
    "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertificateArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAudit" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "subjectId" TEXT,
    "action" TEXT NOT NULL,
    "secretaryId" INTEGER,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventRateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PresenceChallenge" (
    "id" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "checkpoint" TEXT NOT NULL,
    "checkpointVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PresenceChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventSeries_slug_key" ON "EventSeries"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "VisitorRegistration_seriesId_emailHash_key" ON "VisitorRegistration"("seriesId", "emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "VisitorRegistration_seriesId_cpfHash_key" ON "VisitorRegistration"("seriesId", "cpfHash");

-- CreateIndex
CREATE UNIQUE INDEX "VisitorSession_tokenHash_key" ON "VisitorSession"("tokenHash");

-- CreateIndex
CREATE INDEX "VisitorSession_expiresAt_idx" ON "VisitorSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipant_eventId_visitorId_key" ON "EventParticipant"("eventId", "visitorId");

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipant_eventId_accountId_key" ON "EventParticipant"("eventId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "CertificateTemplate_name_role_version_key" ON "CertificateTemplate"("name", "role", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EventAsset_storageKey_key" ON "EventAsset"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "CertificateArtifact_certificateId_key" ON "CertificateArtifact"("certificateId");

-- CreateIndex
CREATE INDEX "CertificateArtifact_state_nextAttemptAt_idx" ON "CertificateArtifact"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EventAudit_eventId_createdAt_idx" ON "EventAudit"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "PresenceChallenge_expiresAt_idx" ON "PresenceChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_participantId_key" ON "Attendance"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_participantId_key" ON "Certificate"("participantId");
CREATE UNIQUE INDEX "Attendance_participantId_eventId_key" ON "Attendance"("participantId", "eventId");
CREATE UNIQUE INDEX "Certificate_participantId_eventId_key" ON "Certificate"("participantId", "eventId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "EventSeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorRegistration" ADD CONSTRAINT "VisitorRegistration_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "EventSeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorSession" ADD CONSTRAINT "VisitorSession_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "VisitorRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "VisitorRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateArtifact" ADD CONSTRAINT "CertificateArtifact_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "Certificate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserva a identidade histórica sem criar alunos ou matrículas de visitante.
INSERT INTO "EventParticipant" ("id", "eventId", "accountId", "name", "course", "role")
SELECT gen_random_uuid()::text, "eventId", "studentAccountId", "studentName", "studentCourse", 'ATTENDEE'
FROM "Attendance" WHERE "studentAccountId" IS NOT NULL
ON CONFLICT ("eventId", "accountId") DO NOTHING;
UPDATE "Attendance" a SET "participantId" = p."id" FROM "EventParticipant" p
WHERE p."eventId" = a."eventId" AND p."accountId" = a."studentAccountId";
UPDATE "Certificate" c SET "participantId" = a."participantId" FROM "Attendance" a
WHERE a."id" = c."attendanceId";

ALTER TABLE "EventParticipant" ADD CONSTRAINT "participant_identity_exclusive" CHECK (NOT ("visitorId" IS NOT NULL AND "accountId" IS NOT NULL));
ALTER TABLE "EventParticipant" ADD CONSTRAINT "participant_role" CHECK ("role" IN ('ATTENDEE', 'SPEAKER'));
ALTER TABLE "EventParticipant" ADD CONSTRAINT "participant_event_unique" UNIQUE ("id", "eventId");
ALTER TABLE "Attendance" ADD CONSTRAINT "attendance_participant_event" FOREIGN KEY ("participantId", "eventId") REFERENCES "EventParticipant"("id", "eventId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Certificate" ADD CONSTRAINT "certificate_participant_event" FOREIGN KEY ("participantId", "eventId") REFERENCES "EventParticipant"("id", "eventId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Event" ADD CONSTRAINT "event_window_minutes" CHECK ("windowMinutes" IS NULL OR "windowMinutes" = 15);
ALTER TABLE "EventSeries" ADD CONSTRAINT "series_dates" CHECK ("endsAt" > "startsAt" AND "retentionAt" > "endsAt");
ALTER TABLE "Attendance" ADD CONSTRAINT "attendance_visitor_identity" CHECK ("studentRa" IS NOT NULL OR "participantId" IS NOT NULL);
ALTER TABLE "Certificate" ADD CONSTRAINT "certificate_visitor_identity" CHECK ("studentRa" IS NOT NULL OR "participantId" IS NOT NULL);
