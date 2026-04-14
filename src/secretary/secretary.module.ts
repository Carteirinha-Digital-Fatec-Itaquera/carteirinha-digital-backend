import { Module } from '@nestjs/common';
import { SecretaryController } from './secretary.controller';
import { SecretaryService } from './secretary.service';
import { SecretaryMapper } from './mapper/secretary.mapper';
import { DatabaseModule } from '../../src/database/database.module';
import { PrismaService } from '../database/prisma.service';
import { SecretaryRepository } from './repository/secretary.repository';
import { PrismaSecretaryRepository } from './repository/prisma/prisma.secretary.repository';
import { UtilsModule } from '../../src/utils/utilsModule';


@Module({
  imports: [DatabaseModule, UtilsModule], 
import { DatabaseModule } from 'src/database/database.module';
import { StudentModule } from 'src/student/student.module';

@Module({
  imports: [DatabaseModule, StudentModule],
  controllers: [SecretaryController],
  providers: [
    SecretaryService, 
    SecretaryMapper,
    PrismaService,{
      provide: SecretaryRepository,
      useClass: PrismaSecretaryRepository
    }
  ],
})
export class SecretaryModule {}