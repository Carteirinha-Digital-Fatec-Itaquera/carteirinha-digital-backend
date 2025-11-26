import { Module } from '@nestjs/common';
import { SecretaryService } from './secretary.service';
import { SecretaryController } from './secretary.controller';

@Module({
  providers: [SecretaryService],
  controllers: [SecretaryController]
})
export class SecretaryModule {}
