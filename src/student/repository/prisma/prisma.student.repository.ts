import { PrismaService } from '../../../database/prisma.service';

import { StudentEntity } from '../../../../src/student/entities/student.entity';
import { StudentRepository } from '../student.repository';
import { Injectable } from '@nestjs/common';
import passport from 'passport';

@Injectable()
export class PrismaStudentRepository implements StudentRepository {
  constructor(private prisma: PrismaService) {}

  findAll(): Promise<StudentEntity[]> {
    return this.prisma.student.findMany();
  }

  findByRa(ra: string): Promise<StudentEntity | null> {
    return this.prisma.student.findUnique({
      where: { ra: ra },
    });
  }

  findByTokenQrcode(qrcode: string): Promise<StudentEntity | null>{
    return this.prisma.student.findUnique({
      where: { qrcode }
    })
  }

  findByEmail(email: string): Promise<StudentEntity | null> {
    return this.prisma.student.findUnique({
      where: { email: email },
    });
  }
  
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
        qrcode: student.qrcode,
        birthDate: student.birthDate,
        dueDate: student.dueDate,
        password: student.password,
      },
    });
  }

  async update(student: StudentEntity): Promise<void>{
    await this.prisma.student.update({
      where: { ra: student.ra },
      data: {
        course: student.course,
        period: student.period,
        status: student.status,
        name: student.name,
        admission: student.admission,
        email: student.email,
        cpf: student.cpf,
        rg: student.rg,
        photo: null,
        birthDate: student.birthDate,
        dueDate: student.dueDate,
      },
    });
  }

  async delete(ra: string): Promise<void> {
    await this.prisma.student.delete({
      where: { ra: ra },
    });
  }

  async updateLastLogin(ra: string): Promise<void> {
      await this.prisma.student.update({
        where: { ra },
        data: {
          lastLogin: new Date(),
        },
      });
  }

  async updatePassword(ra: string, newPassword:string): Promise<void> {
    await this.prisma.student.update({
      where: {ra},
      data:  {
        password: newPassword
      }
    })
  }
}
