import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import {
  CertificateController,
  CertificateVerificationController,
} from './certificate.controller';
import { CertificateService } from './certificate.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { CertificateRateLimitGuard } from './certificate-rate-limit.guard';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [CertificateVerificationController, CertificateController],
  providers: [
    CertificateService,
    PdfGeneratorService,
    CertificateRateLimitGuard,
  ],
  exports: [CertificateService, PdfGeneratorService],
})
export class CertificateModule {}
