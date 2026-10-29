ALTER TABLE "Event" ADD COLUMN "attendancePublicReference" TEXT;
CREATE UNIQUE INDEX "Event_attendancePublicReference_key" ON "Event"("attendancePublicReference");
