-- CreateTable
CREATE TABLE "AttendanceQrReference" (
    "id" TEXT NOT NULL,
    "referenceHash" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "checkpointVersion" INTEGER NOT NULL,
    "jwtToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceQrReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceQrReference_referenceHash_key" ON "AttendanceQrReference"("referenceHash");

-- CreateIndex
CREATE INDEX "AttendanceQrReference_expiresAt_idx" ON "AttendanceQrReference"("expiresAt");

-- CreateIndex
CREATE INDEX "AttendanceQrReference_checkpointId_checkpointVersion_idx" ON "AttendanceQrReference"("checkpointId", "checkpointVersion");

-- AddForeignKey
ALTER TABLE "AttendanceQrReference" ADD CONSTRAINT "AttendanceQrReference_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "EventCheckpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
