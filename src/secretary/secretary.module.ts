import { Module } from '@nestjs/common';
import { SecretaryService } from './secretary.service';
import { SecretaryController } from './secretary.controller';
import { SecretaryMapper } from './mapper/secretary.mapper';

@Module({
  imports: [],
  controllers: [SecretaryController],
  providers: [SecretaryService, SecretaryMapper],
})
export class SecretaryModule {}
