import { StatusContaSecretaria } from "@prisma/client";

export class CreateSecretaryDTO {
  id?: number;
  name: string;
  email: string;
  dueDate: string;
  password: string;
  statusConta: StatusContaSecretaria;
  lasLogin: Date | null
}
