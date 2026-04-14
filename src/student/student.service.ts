import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateStudentDTO } from './dto/create-student.dto';
import { StudentEntity } from './entities/student.entity';
import { StudentMapper } from './mapper/student.mapper';
import { StudentRepository } from './repository/student.repository';
import { error } from 'console';
import ValidarCpf from '../../src/utils/validadorCpf';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { HashContentService } from '../../src/utils/hashContentService';

import { PrismaService } from 'src/database/prisma.service'; // Adicione

@Injectable()
export class StudentService {
  constructor(
    private readonly mapper: StudentMapper,
    private readonly repository: StudentRepository,
    private readonly hashService: HashContentService 
    private readonly prisma: PrismaService, // Adicione
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

  async findByTokenQrcode(qrcode: string): Promise<StudentEntity>{
    const result = await this.repository.findByTokenQrcode(qrcode)

    if(result == null){
      throw new NotFoundException('Estudante não encontrado')
    }
    return result

  }

  async getStudentByEmail(ra: string): Promise<StudentEntity> {
    const result = await this.repository.findByEmail(ra);
    if (result == null) {
      throw new NotFoundException('Estudante não encontrado');
    }
    return result;
  }

  async validarTokenQrcode(qrcode: string): Promise<StudentEntity> {
  const student = await this.repository.findByTokenQrcode(qrcode);

  if (!student) {
    throw new NotFoundException(`Estudante não encontrado`);
  }

  if (student.status !== 'Ativo') {
    throw new BadRequestException('Aluno não está ativo');
  }

  if (new Date() > new Date(student.dueDate)) {
    throw new BadRequestException('Carteirinha vencida');
  }

  return student;
}

  async createStudent(student: CreateStudentDTO) {
    try {
      const rawPassoword = this.generateInitialPassword(student.birthDate)
      const passwordHash = await this.hashService.hashContent(rawPassoword)
      
      ValidarCpf(student.cpf); 
      const token = randomUUID();
      const entity = this.mapper.toEntity({
        ...student,
        password: passwordHash,
        lastLogin:null
      });
      entity.qrcode = token;

      return await this.repository.create(entity);
    
    } catch (error) {
      
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new BadRequestException(
            'Já existe um registro com esses dados, verifique email, RG ou CPF'
          );
        }
    }

    throw error;
  }
}

  async updateStudents(student: StudentEntity) {
    const result =  await this.repository.findByRa(student.ra);
    ValidarCpf(student.cpf);
    
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
  async updateLastLoginStudent(ra: string) {
    return await this.repository.updateLastLogin(ra);
  } 

  async updateStudentPassword(ra:string, newPassword:string){
    return await this.repository.updatePassword(ra, newPassword)
  }

  private generateInitialPassword(birthDate: Date): string {
    const date = new Date(birthDate);
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = String(date.getUTCFullYear());
    
    return `${day}${month}${year}`;
  }

  // ========== NOVOS MÉTODOS DE FOTO ==========

  async requestPhotoApproval(ra: string, photoUrl: string) {
    return this.prisma.student.update({
      where: { ra },
      data: {
        photo: photoUrl,
        photoStatus: 'PENDING',
      },
    });
  }

  async getPhotoStatus(ra: string) {
    const student = await this.prisma.student.findUnique({
      where: { ra },
      select: { 
        ra: true, 
        name: true, 
        photo: true, 
        photoStatus: true, 
        rejectionReason: true 
      },
    });

    if (!student) {
      throw new NotFoundException('Estudante não encontrado');
    }

    return student;
  }

  async getPendingPhotos() {
    return this.prisma.student.findMany({
      where: { 
        photoStatus: 'PENDING', 
        photo: { not: null } 
      },
      select: { 
        ra: true, 
        name: true, 
        photo: true, 
        email: true 
      },
    });
  }

  async approvePhoto(ra: string, status: string, rejectionReason: string | null, secretaryId: string) {
    const student = await this.prisma.student.findUnique({ where: { ra } });
    
    if (!student) {
      throw new NotFoundException('Estudante não encontrado');
    }

    return this.prisma.student.update({
      where: { ra },
      data: {
        photoStatus: status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        approvedBy: secretaryId,
        approvedAt: status === 'APPROVED' ? new Date() : null,
        rejectionReason: rejectionReason,
      },
    });
  }
}