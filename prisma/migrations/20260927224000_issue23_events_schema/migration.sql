-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CheckpointType" AS ENUM ('CHECK_IN', 'CHECK_OUT');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('CHECKED_IN', 'CONFIRMED');

-- Keep the old Student insert path working while filling existing rows. The
-- database default is intentional: Prisma's uuid() default is client-side.
ALTER TABLE "Student" ADD COLUMN "accountId" TEXT;
ALTER TABLE "Student" ALTER COLUMN "accountId" SET DEFAULT gen_random_uuid()::text;
UPDATE "Student" SET "accountId" = gen_random_uuid()::text WHERE "accountId" IS NULL;
ALTER TABLE "Student" ALTER COLUMN "accountId" SET NOT NULL;

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "speaker" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "workloadMinutes" INTEGER NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "certificateEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventCheckpoint" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" "CheckpointType" NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "studentRa" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "studentCourse" TEXT NOT NULL,
    "studentAccountId" TEXT NOT NULL,
    "studentRefRa" TEXT,
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "status" "AttendanceStatus" NOT NULL DEFAULT 'CHECKED_IN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "studentRa" TEXT NOT NULL,
    "studentAccountId" TEXT NOT NULL,
    "studentRefRa" TEXT,
    "attendanceId" TEXT NOT NULL,
    "verificationCode" TEXT NOT NULL,
    "payloadSnapshot" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- Historical identity must match the optional live Student reference. The
-- reference may become NULL without changing the retained snapshots.
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_studentRefRa_matches_snapshot"
    CHECK ("studentRefRa" IS NULL OR "studentRefRa" = "studentRa");
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_studentRefRa_matches_snapshot"
    CHECK ("studentRefRa" IS NULL OR "studentRefRa" = "studentRa");

-- CreateIndex
CREATE INDEX "Event_createdById_idx" ON "Event"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "EventCheckpoint_eventId_type_key" ON "EventCheckpoint"("eventId", "type");

-- CreateIndex
CREATE INDEX "Attendance_studentRefRa_studentAccountId_idx" ON "Attendance"("studentRefRa", "studentAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_eventId_studentRa_key" ON "Attendance"("eventId", "studentRa");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_attendanceId_key" ON "Certificate"("attendanceId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_verificationCode_key" ON "Certificate"("verificationCode");

-- CreateIndex
CREATE INDEX "Certificate_studentRefRa_studentAccountId_idx" ON "Certificate"("studentRefRa", "studentAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_eventId_studentRa_key" ON "Certificate"("eventId", "studentRa");

-- CreateIndex
CREATE UNIQUE INDEX "Student_accountId_key" ON "Student"("accountId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Secretary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCheckpoint" ADD CONSTRAINT "EventCheckpoint_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_studentRefRa_fkey" FOREIGN KEY ("studentRefRa") REFERENCES "Student"("ra") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_studentRefRa_fkey" FOREIGN KEY ("studentRefRa") REFERENCES "Student"("ra") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- These database guards preserve identity and historical evidence even when
-- a caller bypasses Prisma. SetNull, checkout, and revocation remain allowed.
CREATE FUNCTION "issue23_guard_student_account_id"() RETURNS trigger AS $$
BEGIN
    IF NEW."accountId" IS DISTINCT FROM OLD."accountId" THEN
        RAISE EXCEPTION 'Student.accountId is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Student_accountId_immutable"
    BEFORE UPDATE OF "accountId" ON "Student"
    FOR EACH ROW EXECUTE FUNCTION "issue23_guard_student_account_id"();

CREATE FUNCTION "issue23_guard_attendance_snapshot"() RETURNS trigger AS $$
BEGIN
    IF ROW(NEW."eventId", NEW."studentRa", NEW."studentName", NEW."studentCourse",
           NEW."studentAccountId", NEW."checkInAt") IS DISTINCT FROM
       ROW(OLD."eventId", OLD."studentRa", OLD."studentName", OLD."studentCourse",
           OLD."studentAccountId", OLD."checkInAt") THEN
        RAISE EXCEPTION 'Attendance historical snapshot is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Attendance_snapshot_immutable"
    BEFORE UPDATE ON "Attendance"
    FOR EACH ROW EXECUTE FUNCTION "issue23_guard_attendance_snapshot"();

CREATE FUNCTION "issue23_guard_certificate_snapshot"() RETURNS trigger AS $$
BEGIN
    IF ROW(NEW."eventId", NEW."studentRa", NEW."studentAccountId", NEW."attendanceId",
           NEW."verificationCode", NEW."payloadSnapshot", NEW."issuedAt") IS DISTINCT FROM
       ROW(OLD."eventId", OLD."studentRa", OLD."studentAccountId", OLD."attendanceId",
           OLD."verificationCode", OLD."payloadSnapshot", OLD."issuedAt") THEN
        RAISE EXCEPTION 'Certificate historical snapshot is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Certificate_snapshot_immutable"
    BEFORE UPDATE ON "Certificate"
    FOR EACH ROW EXECUTE FUNCTION "issue23_guard_certificate_snapshot"();
