import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { StudentService } from 'src/student/student.service';
import { JwtService } from '@nestjs/jwt';
import { StudentMapper } from 'src/student/mapper/student.mapper';
import { SecretaryService } from 'src/secretary/secretary.service';
import { SecretaryMapper } from 'src/secretary/mapper/secretary.mapper';
import { StudentRepository } from 'src/student/repository/student.repository';
import { PrismaStudentRepository } from 'src/student/repository/prisma/prisma.student.repository';
import { PrismaService } from 'src/database/prisma.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    StudentService,
    JwtService,
    StudentMapper,
    SecretaryService,
    SecretaryMapper,
    PrismaService,
    {
      provide: StudentRepository,
      useClass: PrismaStudentRepository,
    },
  ],
})
export class AuthModule {}
