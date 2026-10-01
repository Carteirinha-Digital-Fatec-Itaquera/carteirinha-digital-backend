-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" INTEGER;

-- CreateIndex
CREATE INDEX "Event_cancelledById_idx" ON "Event"("cancelledById");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "Secretary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Revoga certificados válidos preexistentes de eventos que já estavam CANCELLED antes desta migration
UPDATE "Certificate"
SET "revokedAt" = NOW()
WHERE "revokedAt" IS NULL
  AND "attendanceId" IN (
    SELECT a."id"
    FROM "Attendance" a
    JOIN "Event" e ON e."id" = a."eventId"
    WHERE e."status" = 'CANCELLED'
  );
