import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateStudentDTO } from './dto/create-student.dto';
import { StudentEntity } from './entities/student.entity';
import { StudentMapper } from './mapper/student.mapper';
import { StudentRepository } from './repository/student.repository';
import { error } from 'console';
import ValidarCpf from 'src/utils/validadorCpf';
import { Prisma } from '@prisma/client';

import { HashContentService } from 'src/utils/hashContentService';
@Injectable()
export class StudentService {
  constructor(
    private readonly mapper: StudentMapper,
    private readonly repository: StudentRepository,
    private readonly hashService: HashContentService,

  ) {}
  async getStudents(): Promise<StudentEntity[]> {
    return (await this.repository.findAll()).map((student) => student);
  }

  async getStudentByRa(ra: string): Promise<StudentEntity> {
    const result = await this.repository.findByRa(ra);
    if (result == null) {
      throw new NotFoundException('Estudante não encontrado');
    }
    return result;
  }

  async getStudentByEmail(email: string): Promise<StudentEntity> {
    const result = await this.repository.findByEmail(email);
    if (result == null) {
      throw new NotFoundException('Estudante não encontrado');
    }
    return result;
  }

  async createStudent(student: CreateStudentDTO) {
   ValidarCpf(student.cpf)
  
    return await this.repository.create(this.mapper.toEntity(student));
  }
}

  async updateStudents(student: StudentEntity) {
    const result =  await this.repository.findByRa(student.ra);
    ValidarCpf(student.cpf)
    
    if(result == null) {
      throw new NotFoundException('Estudante não encontrado');
    }
    return await this.repository.update(student);
  }

  async deleteStudent(ra: string) {
    const result = await this.repository.findByRa(ra);

    if(result == null) {
      throw new NotFoundException('Estudante não encontrado');
    }
    return await this.repository.delete(ra);
  }
}
