-- Preserve the current-document invariant for older writers during the coordinated release.
UPDATE "Certificate" c SET "activeAttendanceId" = c."attendanceId", "activeParticipantId" = c."participantId"
WHERE c."activeAttendanceId" IS NULL AND c."revokedAt" IS NULL
AND NOT EXISTS (SELECT 1 FROM "Certificate" other WHERE other."activeAttendanceId" = c."attendanceId");

CREATE FUNCTION certificate_default_current_links() RETURNS trigger AS $$
BEGIN
  IF NEW."activeAttendanceId" IS NULL AND NEW."revokedAt" IS NULL THEN
    NEW."activeAttendanceId" := NEW."attendanceId";
    NEW."activeParticipantId" := NEW."participantId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER certificate_default_current_links BEFORE INSERT ON "Certificate"
FOR EACH ROW EXECUTE FUNCTION certificate_default_current_links();
ALTER TABLE "Certificate" ADD CONSTRAINT "certificate_valid_is_current_check"
CHECK ("revokedAt" IS NOT NULL OR "activeAttendanceId" IS NOT NULL);
