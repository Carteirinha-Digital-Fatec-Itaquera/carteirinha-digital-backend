import { Module } from '@nestjs/common';
import { SecretaryController } from './secretary.controller';
import { SecretaryService } from './secretary.service';
import { SecretaryMapper } from './mapper/secretary.mapper';
import { DatabaseModule } from '../../src/database/database.module';
import { PrismaService } from '../database/prisma.service';
import { SecretaryRepository } from './repository/secretary.repository';
import { PrismaSecretaryRepository } from './repository/prisma/prisma.secretary.repository';
import { UtilsModule } from '../../src/utils/utilsModule';
import { StudentModule } from 'src/student/student.module';
import { StudentService } from 'src/student/student.service';
import { StudentEntity } from 'src/student/entities/student.entity';
import { StudentMapper } from 'src/student/mapper/student.mapper';
import { StudentRepository } from 'src/student/repository/student.repository';
import { PrismaStudentRepository } from 'src/student/repository/prisma/prisma.student.repository';


// @Module({
//   imports: [DatabaseModule, UtilsModule], 
// import { DatabaseModule } from 'src/database/database.module';
// import { StudentModule } from 'src/student/student.module';

@Module({
  imports: [DatabaseModule, UtilsModule],
  controllers: [SecretaryController],
  providers: [
    StudentService,
    StudentMapper,

    SecretaryService, 
    SecretaryMapper,
    PrismaService,
    {
      provide: SecretaryRepository,
      useClass: PrismaSecretaryRepository
    },
    {
      provide: StudentRepository,
      useClass: PrismaStudentRepository,
    }
  ],
})
export class SecretaryModule {}