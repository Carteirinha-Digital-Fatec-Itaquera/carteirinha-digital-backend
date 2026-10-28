ALTER TABLE "Student" ADD COLUMN "socialName" TEXT;
ALTER TABLE "Certificate" ADD COLUMN "activeAttendanceId" TEXT,
ADD COLUMN "activeParticipantId" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "replacesId" TEXT, ADD COLUMN "reissueKey" TEXT,
ADD COLUMN "revocationReason" TEXT, ADD COLUMN "reissuedById" INTEGER;
UPDATE "Certificate" SET "activeAttendanceId" = "attendanceId", "activeParticipantId" = "participantId";
DROP INDEX "Certificate_attendanceId_key";
DROP INDEX "Certificate_participantId_key";
DROP INDEX "Certificate_eventId_studentRa_key";
DROP INDEX "Certificate_participantId_eventId_key";
CREATE UNIQUE INDEX "Certificate_activeAttendanceId_key" ON "Certificate"("activeAttendanceId");
CREATE UNIQUE INDEX "Certificate_activeParticipantId_key" ON "Certificate"("activeParticipantId");
CREATE UNIQUE INDEX "Certificate_attendanceId_version_key" ON "Certificate"("attendanceId", "version");
CREATE UNIQUE INDEX "Certificate_replacesId_key" ON "Certificate"("replacesId");
CREATE UNIQUE INDEX "Certificate_reissueKey_key" ON "Certificate"("reissueKey");
CREATE UNIQUE INDEX "certificate_current_event_ra" ON "Certificate"("eventId", "studentRa") WHERE "activeAttendanceId" IS NOT NULL;
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_activeAttendanceId_fkey" FOREIGN KEY ("activeAttendanceId") REFERENCES "Attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_activeParticipantId_fkey" FOREIGN KEY ("activeParticipantId") REFERENCES "EventParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "Certificate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Certificate" ADD CONSTRAINT "certificate_current_attendance_check" CHECK ("activeAttendanceId" IS NULL OR "activeAttendanceId" = "attendanceId");
ALTER TABLE "Certificate" ADD CONSTRAINT "certificate_current_participant_check" CHECK ("activeParticipantId" IS NULL OR "activeParticipantId" = "participantId");
