import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateStudentDTO } from './dto/create-student.dto';
import { StudentEntity } from './entities/student.entity';
import { StudentMapper } from './mapper/student.mapper';
import { StudentRepository } from './repository/student.repository';

@Injectable()
export class StudentService {
  constructor(
    private readonly mapper: StudentMapper,
    private readonly repository: StudentRepository,
  ) {}

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

  async createStudent(student: CreateStudentDTO) {
    await this.repository.create(this.mapper.toEntity(student));
  }
}
