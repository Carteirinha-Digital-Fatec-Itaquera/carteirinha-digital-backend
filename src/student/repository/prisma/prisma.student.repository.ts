import { PrismaService } from 'src/database/prisma.service';
import { StudentEntity } from 'src/student/entities/student.entity';
import { StudentRepository } from '../student.repository';
import { Injectable } from '@nestjs/common';

@Injectable()
export class PrismaStudentRepository implements StudentRepository {
  constructor(private prisma: PrismaService) {}

  async create(student: StudentEntity): Promise<void> {
    await this.prisma.student.create({
      data: {
        ra: student.ra,
        course: student.course,
        period: student.period,
        status: student.status,
        name: student.name,
        admission: student.admission,
        email: student.email,
        cpf: student.cpf,
        rg: student.rg,
        photo: null,
        qrcode: null,
        birthDate: student.birthDate,
        dueDate: student.dueDate,
        password: null,
      },
    });
  }
}
