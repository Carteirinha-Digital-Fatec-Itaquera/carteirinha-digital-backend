import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateStudentDTO } from './dto/create-student.dto';
import { StudentEntity } from './model/student.entity';
import { StudentMapper } from './mapper/student.mapper';

@Injectable()
export class StudentService {
  constructor(private readonly mapper: StudentMapper) {}

  private list: StudentEntity[] = [];

  getStudents(): StudentEntity[] {
    return this.list.map((student) => student);
  }

  getStudentByRa(ra: string): StudentEntity {
    const result = this.list.find((student) => student.ra == ra);
    if (result == undefined) {
      throw new NotFoundException('Estudante não encontrado');
    }
    return result;
  }

  getStudentByEmail(email: string): StudentEntity {
    const result = this.list.find((student) => student.email == email);
    if (result == undefined) {
      throw new NotFoundException('Estudante não encontrado');
    }
    return result;
  }

  createStudent(student: CreateStudentDTO) {
    this.list.push(this.mapper.toEntity(student));
  }
}
