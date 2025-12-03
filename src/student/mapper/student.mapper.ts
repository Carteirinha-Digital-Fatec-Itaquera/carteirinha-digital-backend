import { Injectable } from '@nestjs/common';
import { StudentEntity } from '../entities/student.entity';
import { ViewStudentDTO } from '../dto/view-student.dto';
import { CreateStudentDTO } from '../dto/create-student.dto';

@Injectable()
export class StudentMapper {
  constructor() {}

  toEntity(student: CreateStudentDTO): StudentEntity {
    return new StudentEntity(
      student.ra,
      student.course,
      student.period,
      student.status,
      student.name,
      student.admission,
      student.email,
      student.cpf,
      student.rg,
      null,
      null,
      new Date(student.birthDate),
      new Date(student.dueDate),
      null,
    );
  }

  toDTO(student: StudentEntity): ViewStudentDTO {
    return new ViewStudentDTO(
      student.ra,
      student.course,
      student.period,
      student.status,
      student.name,
      student.admission,
      student.email,
      student.cpf,
      student.rg,
      student.qrcode || '',
      student.photo || '',
      student.birthDate,
      student.dueDate,
    );
  }

  toListDTO(student: StudentEntity[]): ViewStudentDTO[] {
    return student.map((student) => this.toDTO(student));
  }
}
