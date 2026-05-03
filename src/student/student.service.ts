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
    private readonly hashService: HashContentService ,
    private readonly prisma: PrismaService, // Adicione
  ) {}
  
  async getStudents(query?: string): Promise<StudentEntity[]> {
  if (!query || query.trim() === '') {
    return (await this.repository.findAll()).map((student) => student);
  }

  return this.prisma.student.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } },
        { ra: { contains: query, mode: 'insensitive' } },
        { cpf: { contains: query, mode: 'insensitive' } },
        { course: { contains: query, mode: 'insensitive' } },
        { status: { contains: query, mode: 'insensitive' } },
      ],
    },
  });
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

    // if (student.status !== 'Ativo') {
    //   throw new BadRequestException('Aluno não está ativo');
    // }
    const statusFormatado = student.status?.trim().toLowerCase();

    if (statusFormatado !== 'ativo' && statusFormatado !== 'em curso') {
      throw new BadRequestException('Aluno não está ativo');
    }
    
    if (new Date() > new Date(student.dueDate)) {
      throw new BadRequestException('Carteirinha vencida');
    }

    return student;
}

  async createStudent(student: CreateStudentDTO) {
  try {
    console.log('admission recebido:', student.admission);
    console.log('birthDate recebido:', student.birthDate);

    const rawPassword = this.generateInitialPassword(student.birthDate);
    const passwordHash = await this.hashService.hashContent(rawPassword);

    ValidarCpf(student.cpf);
    const token = randomUUID();

    // Trata os dois formatos: 20251 ou 2025-01-01
    const admissionStr = student.admission.toString().replace(/-/g, '');
    const admissionYear = parseInt(admissionStr.substring(0, 4));
    const admissionSemester = admissionStr.length === 5
      ? parseInt(admissionStr.substring(4, 5))
      : 1;
    const admissionMonth = admissionSemester === 2 ? 7 : 1;
    const dueDate = new Date(admissionYear + 5, admissionMonth - 1, 1)
      .toISOString()
      .split('T')[0];

    console.log('dueDate calculado:', dueDate);

    const entity = this.mapper.toEntity({
      ...student,
      dueDate,
      password: passwordHash,
      lastLogin: null,
    });
    entity.qrcode = token;

    console.log('entity criada:', {
  ra: entity.ra,
  qrcode: entity.qrcode,
  password: entity.password ? 'ok' : 'NULO',
  birthDate: entity.birthDate,
  dueDate: entity.dueDate,
});

    return await this.repository.create(entity);

  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new BadRequestException(
          'Já existe um registro com esses dados, verifique email, RG ou CPF'
        );
      }
    }''
    throw error;
  }
}


  async updateStudents(student: Partial<StudentEntity> & { ra: string }) {
  const result = await this.repository.findByRa(student.ra);
  console.log('photo no result:', result?.photo);
  console.log('photo no student:', student.photo);

  if (result == null) {
    throw new NotFoundException('Estudante não encontrado');
  }

  const updated = { ...result, ...student };
  console.log('photo no updated:', updated.photo);
  
  if (student.photo === null || student.photo === undefined) {
  updated.photo = result.photo;
  }

 console.log('photo no updated após fix:', updated.photo);

  if (updated.cpf) ValidarCpf(updated.cpf);

  // Recalcula dueDate sempre que admission mudar
  if (student.admission && student.admission !== result.admission) {
    const admissionYear = parseInt(updated.admission.toString().substring(0, 4));
    const admissionSemester = updated.admission.toString().length === 5
      ? parseInt(updated.admission.toString().substring(4, 5))
      : 1;
    const admissionMonth = admissionSemester === 2 ? 7 : 1;
    updated.dueDate = new Date(admissionYear + 5, admissionMonth - 1, 1);
  }

  // Se status não é "Em curso", força carteirinha vencida
  if (updated.status?.trim().toLowerCase() !== 'em curso' && updated.status?.trim().toLowerCase() !== 'ativo') {
  updated.dueDate = new Date('2000-01-01');
} else {
  const admissionYear = parseInt(updated.admission.toString().substring(0, 4));
  const admissionSemester = updated.admission.toString().length === 5
    ? parseInt(updated.admission.toString().substring(4, 5))
    : 1;
  const admissionMonth = admissionSemester === 2 ? 7 : 1;
  updated.dueDate = new Date(admissionYear + 5, admissionMonth - 1, 1);
}

  return await this.repository.update(updated as StudentEntity);
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

  async removePhoto(ra: string) {
  const student = await this.prisma.student.findUnique({ where: { ra } });

  if (!student) {
    throw new NotFoundException('Estudante não encontrado');
  }

  return this.prisma.student.update({
    where: { ra },
    data: {
      photo: null,
      photoStatus: 'PENDING',
      approvedAt: null,
      approvedBy: null,
      rejectionReason: null,
    },
  });
}
}