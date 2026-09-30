import {
  Controller,
  Get,
  Header,
  Param,
  Request,
  Response,
  UseGuards,
  StreamableFile,
} from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { TokenPayload } from '../auth/dto/payload.dto';
import { CertificateService } from './certificate.service';
import { CertificateRateLimitGuard } from './certificate-rate-limit.guard';

/**
 * Controller público de verificação de autenticidade.
 * Rota estática declarada separadamente para evitar conflito com :id.
 */
@Controller('certificates')
export class CertificateVerificationController {
  constructor(private readonly certificateService: CertificateService) {}

  @Get('verify/:code')
  @UseGuards(CertificateRateLimitGuard)
  @Header('Cache-Control', 'no-store')
  verify(@Param('code') code: string) {
    return this.certificateService.verifyCertificate(code);
  }
}

/**
 * Controller privado de consulta e download de certificados por alunos.
 */
@Controller('certificates')
@UseGuards(AuthGuard, RolesGuard)
@Roles('student')
export class CertificateController {
  constructor(private readonly certificateService: CertificateService) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  findMine(@Request() req: { user: TokenPayload }) {
    return this.certificateService.getStudentCertificates(req.user);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  findOne(@Param('id') id: string, @Request() req: { user: TokenPayload }) {
    return this.certificateService.getStudentCertificate(id, req.user);
  }

  @Get(':id/pdf')
  @Header('Cache-Control', 'no-store')
  async downloadPdf(
    @Param('id') id: string,
    @Request() req: { user: TokenPayload },
    @Response({ passthrough: true }) res: ExpressResponse,
  ): Promise<StreamableFile> {
    const { buffer, verificationCode } =
      await this.certificateService.generatePdf(id, req.user);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="certificado-${verificationCode}.pdf"`,
    );
    res.setHeader('Cache-Control', 'no-store');

    return new StreamableFile(buffer);
  }
}
