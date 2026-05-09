-- CreateTable
CREATE TABLE "StudentLog" (
    "id" SERIAL NOT NULL,
    "ra" TEXT NOT NULL,
    "course" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "admission" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletionReason" TEXT NOT NULL DEFAULT 'Prazo de 5 anos após admissão encerrado',

    CONSTRAINT "StudentLog_pkey" PRIMARY KEY ("id")
);
