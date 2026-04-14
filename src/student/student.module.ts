import { Module } from '@nestjs/common';
import { StudentController } from './student.controller';
import { StudentService } from './student.service';
import { StudentRepository } from './repository/student.repository';
import { PrismaStudentRepository } from './repository/prisma/prisma.student.repository';
import { PrismaService } from '../../src/database/prisma.service';
import { DatabaseModule } from '../../src/database/database.module';

import { UtilsModule } from '../../src/utils/utilsModule';


@Module({
  imports: [DatabaseModule, UtilsModule],
import { StudentMapper } from './mapper/student.mapper';
import { UploadModule } from '../upload/upload.module'; 

@Module({
  imports: [UploadModule], 
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