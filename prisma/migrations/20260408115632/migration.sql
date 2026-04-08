/*
  Warnings:

  - A unique constraint covering the columns `[qrcode]` on the table `Student` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `birthDate` to the `Secretary` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Secretary" ADD COLUMN     "birthDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "lastLogin" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "lastLogin" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Student_qrcode_key" ON "Student"("qrcode");
