import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { SecretaryActiveGuard } from '../project-credits/guards/secretary-active.guard';
import {
  SupportController,
  SupportAdminController,
} from './support.controller';
import { SupportService } from './support.service';
@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [SupportController, SupportAdminController],
  providers: [SupportService, SecretaryActiveGuard],
})
export class SupportModule {}
