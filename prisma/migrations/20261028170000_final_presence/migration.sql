ALTER TABLE "Event" ADD COLUMN "attendanceMode" TEXT NOT NULL DEFAULT 'FINAL_ONLY';
ALTER TABLE "Event" ADD CONSTRAINT "event_attendance_mode_check" CHECK ("attendanceMode" IN ('FINAL_ONLY', 'TWO_PHASE'));
UPDATE "EventCheckpoint" SET "isOpen" = false, "closedAt" = CURRENT_TIMESTAMP, "closesAt" = NULL, "version" = "version" + 1
WHERE "type" = 'CHECK_IN' AND "isOpen" = true;
