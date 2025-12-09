import { Module } from '@nestjs/common';
import { StudentController } from './student.controller';
import { StudentService } from './student.service';
import { StudentMapper } from './mapper/student.mapper';
import { StudentRepository } from './repository/student.repository';
import { PrismaStudentRepository } from './repository/prisma/prisma.student.repository';
import { PrismaService } from 'src/database/prisma.service';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [DatabaseModule],
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
})
export class StudentModule {}
