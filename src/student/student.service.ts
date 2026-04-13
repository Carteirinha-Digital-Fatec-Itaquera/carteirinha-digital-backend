import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateStudentDTO } from './dto/create-student.dto';
import { StudentEntity } from './entities/student.entity';
import { StudentMapper } from './mapper/student.mapper';
import { StudentRepository } from './repository/student.repository';
import { PrismaService } from 'src/database/prisma.service'; // Adicione

@Injectable()
export class StudentService {
  constructor(
    private readonly mapper: StudentMapper,
    private readonly repository: StudentRepository,
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