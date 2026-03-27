export class StudentEntity {
  constructor(
    ra: string,
    course: string,
    period: string,
    status: string,
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
  ) {
    this.ra = ra;
    this.course = course;
    this.period = period;
    this.status = status;
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
  }
  ra: string;
  course: string;
  period: string;
  status: string;
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
}
