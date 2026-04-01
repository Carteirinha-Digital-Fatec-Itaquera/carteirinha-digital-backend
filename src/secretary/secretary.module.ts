import { Module } from '@nestjs/common';
import { SecretaryController } from './secretary.controller';
import { SecretaryService } from './secretary.service';
import { SecretaryMapper } from './mapper/secretary.mapper';
import { DatabaseModule } from 'src/database/database.module';
import { StudentModule } from 'src/student/student.module';

@Module({
  imports: [DatabaseModule, StudentModule],
  controllers: [SecretaryController],
  providers: [SecretaryService, SecretaryMapper],
})
export class SecretaryModule {}