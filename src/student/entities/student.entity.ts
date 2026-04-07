import { StatusContaAluno } from "@prisma/client";


export class StudentEntity {
  constructor(
    ra: string,
    course: string,
    period: string,
    statusConta: StatusContaAluno,
    name: string,
    admission: string,
    email: string,
    cpf: string,
    rg: string,
    qrcode: string | null,
    photo: string | null,
    birthDate: Date,
    dueDate: Date,
    password: string,
    lastLogin?: Date|null
  ) {
    this.ra = ra;
    this.course = course;
    this.period = period;
    this.statusConta = statusConta;
    this.name = name;
    this.admission = admission;
    this.email = email;
    this.cpf = cpf;
    this.rg = rg;
    this.photo = photo;
    this.qrcode = qrcode;
    this.birthDate = birthDate;
    this.dueDate = dueDate;
    this.password = password;
    
    this.lastLogin = lastLogin
  }
  ra: string;
  course: string;
  period: string;
  statusConta: StatusContaAluno;
  name: string;
  admission: string;
  email: string;
  cpf: string;
  rg: string;
  qrcode: string | null;
  photo: string | null;
  birthDate: Date;
  dueDate: Date;
  password: string;

  lastLogin?: Date |null
}
