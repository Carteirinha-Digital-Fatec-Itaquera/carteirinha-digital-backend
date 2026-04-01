import { Module } from '@nestjs/common';
import { StudentController } from './student.controller';
import { StudentService } from './student.service';
import { StudentRepository } from './repository/student.repository';
import { PrismaStudentRepository } from './repository/prisma/prisma.student.repository';
import { StudentMapper } from './mapper/student.mapper';
import { PrismaService } from 'src/database/prisma.service';

@Module({
  controllers: [StudentController],
  providers: [
    StudentService,
    StudentMapper,
    PrismaService,
    {
      provide: StudentRepository,
      useClass: PrismaStudentRepository,
    },
  ],
  exports: [StudentService],
})
export class StudentModule {}