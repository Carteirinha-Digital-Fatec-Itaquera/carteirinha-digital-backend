/*
  Warnings:

  - You are about to drop the column `period` on the `Student` table. All the data in the column will be lost.
  - You are about to drop the column `rg` on the `Student` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Student_rg_key";

-- AlterTable
ALTER TABLE "Student" DROP COLUMN "period",
DROP COLUMN "rg";
