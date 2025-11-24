import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateStudentDTO } from './dto/create-student.dto';
import { ViewStudentDTO } from './dto/view-student.dto';
import { StudentEntity } from './model/student.entity';
import { StudentMapper } from './mapper/student.mapper';

@Injectable()
export class StudentService {
  constructor(private mapper: StudentMapper) {}

  private list: StudentEntity[] = [];

  getStudents(): ViewStudentDTO[] {
    return this.list.map((student) => this.mapper.toDTO(student));
  }

  getStudent(ra: string): ViewStudentDTO {
    const result = this.list.find((student) => student.ra == ra);
    if (result == undefined) {
      throw NotFoundException;
    }
    return this.mapper.toDTO(result);
  }

  createStudent(student: CreateStudentDTO) {
    this.list.push(this.mapper.toEntity(student));
  }
}
