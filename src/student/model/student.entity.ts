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
    qrcode: string,
    photo: string,
    birthDate: string,
    dueDate: string,
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
  qrcode: string;
  photo: string;
  birthDate: string;
  dueDate: string;
}
