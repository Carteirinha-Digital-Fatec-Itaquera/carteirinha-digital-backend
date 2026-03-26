import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateStudentDTO } from './dto/create-student.dto';
import { StudentEntity } from './entities/student.entity';
import { StudentMapper } from './mapper/student.mapper';
import { StudentRepository } from './repository/student.repository';
import { error } from 'console';

@Injectable()
export class StudentService {
  constructor(
    private readonly mapper: StudentMapper,
    private readonly repository: StudentRepository,
  ) {}
  async getStudents(): Promise<StudentEntity[]> {
    return (await this.repository.findAll()).map((student) => student);
  }

  //
  async getStudentsById(id: string): Promise<StudentEntity>{
    const buscaId = await this.repository.findById(id)
    if (!buscaId){
      throw new error('Estudante não encontrado', NotFoundException)
    }
    
    return buscaId
  }

  async getStudentByRa(ra: string): Promise<StudentEntity> {
    const result = await this.repository.findByRa(ra);
    if (result == null) {
      throw new NotFoundException('Estudante não encontrado');
    }
    return result;
  }

  async getStudentByEmail(ra: string): Promise<StudentEntity> {
    const result = await this.repository.findByEmail(ra);
    if (result == null) {
      throw new NotFoundException('Estudante não encontrado');
    }
    return result;
  }

  async createStudent(student: CreateStudentDTO) {
    await this.repository.create(this.mapper.toEntity(student));
  }
//
  async deleteStudent(id: string) {
    const busca = await this.repository.findById(id)

    if(!busca){
      throw new error('Usuario não encontrado', NotFoundException)
    }
    return await this.repository.delete(id)

  }
  async updateStudent(student: StudentEntity) {
    const buscaStudents = await this.repository.findById(student.id)

    if(!buscaStudents || student.id == null){
      throw new error('Estudante não encontrado', NotFoundException)
    }

    return await this.repository.update(this.mapper.toEntity(student))


  }
}
