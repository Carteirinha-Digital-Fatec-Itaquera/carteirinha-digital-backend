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
<<<<<<< HEAD
  lastLogin?: Date|null;
  statusConta:StatusContaSecretaria
  birthDate: Date
=======
  statusConta:StatusContaSecretaria;
  lastLogin?: Date | null
>>>>>>> 1faccd07d1479805430bd62c2b13d83701a03d79
}
