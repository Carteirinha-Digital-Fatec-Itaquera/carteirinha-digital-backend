import { StatusContaSecretaria } from "@prisma/client";


export class SecretaryEntity {
  constructor(
    id: number,
    name: string,
    email: string,
    dueDate: Date,
    password: string,
    statusConta: StatusContaSecretaria,
    lastLogin?:Date |null

  ) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.dueDate = dueDate;
    this.password = password;
    this.statusConta = statusConta;
    this.lastLogin = lastLogin;
  }

  id: number;
  name: string;
  email: string;
  dueDate: Date;
  password: string;
  statusConta:StatusContaSecretaria;
  lastLogin?: Date | null
}
