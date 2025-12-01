/*
  Warnings:

  - You are about to alter the column `birthDate` on the `Student` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `DateTime(3)`.
  - You are about to alter the column `dueDate` on the `Student` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `DateTime(3)`.

*/
-- DropIndex
DROP INDEX `Student_ra_key` ON `Student`;

-- AlterTable
ALTER TABLE `Student` MODIFY `birthDate` DATETIME(3) NOT NULL,
    MODIFY `dueDate` DATETIME(3) NOT NULL;
