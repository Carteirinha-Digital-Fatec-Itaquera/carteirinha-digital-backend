import { StatusContaSecretaria } from "@prisma/client";

export class SecretaryEntity {
  constructor(
    id: number,
    name: string,
    email: string,
    dueDate: Date,
    password: string,
    statusConta: StatusContaSecretaria,
    birthDate: Date,
    lastLogin?: Date | null
  ) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.dueDate = dueDate;
    this.password = password;
    this.statusConta =statusConta
    this.lastLogin = lastLogin
    this.birthDate = birthDate
  }

  id: number;
  name: string;
  email: string;
  dueDate: Date;
  password: string;
  lastLogin?: Date|null;
  statusConta:StatusContaSecretaria
  birthDate: Date
}
