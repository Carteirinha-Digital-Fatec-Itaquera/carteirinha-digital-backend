import { PhotoStatus } from "@prisma/client";

export class ViewStudentDTO {
  constructor(
    ra: string,
    course: string,
    status: string,
    name: string,
    admission: string,
    email: string,
    cpf: string|null,
    qrcode: string,
    photo: string,
    dueDate: Date,
    birthDate?: Date | null,
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
    this.dueDate = dueDate;
    this.birthDate = birthDate || null;
    this.photoStatus = photoStatus
  }

  ra: string;
  course: string;
  status: string;
  name: string;
  admission: string;
  email: string;
  cpf: string|null;
  qrcode: string;
  photo: string;
  dueDate: Date;
  birthDate?: Date | null;
  photoStatus?: PhotoStatus

}
