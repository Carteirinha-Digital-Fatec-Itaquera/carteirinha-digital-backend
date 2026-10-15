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
import { EventAssetsModule } from '../public-events/event-assets.module';
import { TechnologyPdfService } from './technology-pdf.service';

@Module({
  imports: [DatabaseModule, AuthModule, EventAssetsModule],
  controllers: [CertificateVerificationController, CertificateController],
  providers: [
    CertificateService,
    TechnologyPdfService,
    PdfGeneratorService,
    CertificateRateLimitGuard,
  ],
  exports: [CertificateService, PdfGeneratorService, TechnologyPdfService],
})
export class CertificateModule {}
