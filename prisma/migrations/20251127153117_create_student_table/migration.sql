-- CreateTable
CREATE TABLE `Student` (
    `ra` VARCHAR(191) NOT NULL,
    `course` VARCHAR(191) NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `admission` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `cpf` VARCHAR(191) NOT NULL,
    `rg` VARCHAR(191) NOT NULL,
    `qrcode` VARCHAR(191) NOT NULL,
    `photo` VARCHAR(191) NOT NULL,
    `birthDate` VARCHAR(191) NOT NULL,
    `dueDate` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Student_ra_key`(`ra`),
    UNIQUE INDEX `Student_email_key`(`email`),
    UNIQUE INDEX `Student_cpf_key`(`cpf`),
    UNIQUE INDEX `Student_rg_key`(`rg`),
    PRIMARY KEY (`ra`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
