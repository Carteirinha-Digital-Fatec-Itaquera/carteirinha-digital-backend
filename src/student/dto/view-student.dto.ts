import { PhotoStatus } from "@prisma/client";

export class ViewStudentDTO {
  constructor(
    ra: string,
    course: string,
    status: string,
    name: string,
    admission: string,
    email: string,
    cpf: string,
    qrcode: string,
    photo: string,
    birthDate: Date,
    dueDate: Date,
    photoStatus?: PhotoStatus
  ) {
    this.ra = ra;
    this.course = course;
    this.status = status;
    this.name = name;
    this.admission = admission;
    this.email = email;
    this.cpf = cpf;
    this.photo = photo;
    this.qrcode = qrcode;
    this.birthDate = birthDate;
    this.dueDate = dueDate;
    this.photoStatus = photoStatus
  }

  ra: string;
  course: string;
  status: string;
  name: string;
  admission: string;
  email: string;
  cpf: string;
  qrcode: string;
  photo: string;
  birthDate: Date;
  dueDate: Date;
  photoStatus?: PhotoStatus

}
