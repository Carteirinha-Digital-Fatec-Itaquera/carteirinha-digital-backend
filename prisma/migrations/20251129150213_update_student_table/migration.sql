/*
  Warnings:

  - You are about to drop the `Student` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE `Student`;

-- CreateTable
CREATE TABLE `StudentTable` (
    `ra` VARCHAR(191) NOT NULL,
    `course` VARCHAR(191) NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `admission` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `cpf` VARCHAR(191) NOT NULL,
    `rg` VARCHAR(191) NOT NULL,
    `qrcode` VARCHAR(191) NULL,
    `photo` VARCHAR(191) NULL,
    `birthDate` VARCHAR(191) NOT NULL,
    `dueDate` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NULL,

    UNIQUE INDEX `StudentTable_email_key`(`email`),
    UNIQUE INDEX `StudentTable_cpf_key`(`cpf`),
    UNIQUE INDEX `StudentTable_rg_key`(`rg`),
    PRIMARY KEY (`ra`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
