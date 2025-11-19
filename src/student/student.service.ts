import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateStudentDTO } from './dto/create-student.dto';
import { ViewStudentDTO } from './dto/view-student.dto';

@Injectable()
export class StudentService {
  list: ViewStudentDTO[] = []

  getStudents(): ViewStudentDTO[] {
    return this.list;
  }

  getStudent(ra: string): ViewStudentDTO {
    let student = this.list.find(student => student.ra == ra);
    if (student == undefined) {
      throw NotFoundException
    }
    return student
  }

  createStudent(student: CreateStudentDTO) {
    let viewStudent = new ViewStudentDTO(
      student.ra,
      student.curso,
      student.periodo,
      student.status,
      student.name,
      student.ingresso,
      student.email,
      student.cpf,
      student.rg,
      "",
      "",
      student.dataNascimento,
      student.dataValidade
    )
    
    this.list.push(viewStudent)
  }
}
