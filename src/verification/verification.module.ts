import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { MailModule } from '../mail/mail.module';
import { PrismaService } from 'src/database/prisma.service';

@Module({
  imports: [MailModule],
  controllers: [VerificationController],
  providers: [VerificationService, PrismaService],
})
export class VerificationModule {}