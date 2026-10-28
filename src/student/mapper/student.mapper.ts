import { Injectable } from '@nestjs/common';
import { StudentEntity } from '../entities/student.entity';
import { ViewStudentDTO } from '../dto/view-student.dto';
import { CreateStudentDTO } from '../dto/create-student.dto';
import { PhotoStatus } from '@prisma/client';

@Injectable()
export class StudentMapper {
  constructor() {}

  toEntity(student: CreateStudentDTO): StudentEntity {
  return Object.assign(new StudentEntity(
    student.ra,
    student.course,
    student.status,
    student.name,
    student.admission,
    student.email,
    student.cpf || null,
    null,
    null,
    null,
    // new Date(student.birthDate),
    student.dueDate ? new Date(student.dueDate) : new Date(),
    student.password,
    student.photoStatus,
    null
    ), { socialName: student.socialName == null ? student.socialName : student.socialName.trim().replace(/\s+/g, " ") });
  }

  toDTO(student: StudentEntity): ViewStudentDTO {
    return Object.assign(new ViewStudentDTO(
      student.ra,
      student.course,
      student.status,
      student.name,
      student.admission,
      student.email,
      student.cpf || '',
      student.qrcode || '',
      student.photo || '',
      student.dueDate,
      student.birthDate ?? new Date(),
      student.photoStatus
    ), { socialName: student.socialName == null ? student.socialName : student.socialName.trim().replace(/\s+/g, " ") });
  }

  toListDTO(student: StudentEntity[]): ViewStudentDTO[] {
    return student.map((student) => this.toDTO(student));
  }
}
