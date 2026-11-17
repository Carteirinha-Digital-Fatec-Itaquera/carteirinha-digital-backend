import {
  Controller,
  Get,
  Header,
  HttpStatus,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { PublicEmployeeVerificationResponse } from '../contracts/v1-employees.types';
import { PrismaService } from '../database/prisma.service';
import {
  consumeSqlRateLimit,
  hashRateLimitKey,
} from '../database/rate-limit.helper';
import { EmployeeEligibilityService } from './employee-eligibility.service';
import { EmployeePhotoService } from './employee-photo.service';
import { throwEmployeeError } from './employee.errors';
import { EmployeeMapper } from './mapper/employee.mapper';
import { EmployeeRepository } from './repository/employee.repository';

interface RequestWithIp {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

@Controller('funcionarios/verificar')
export class EmployeePublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: EmployeeRepository,
    private readonly eligibility: EmployeeEligibilityService,
    private readonly mapper: EmployeeMapper,
    private readonly photoService: EmployeePhotoService,
  ) {}

  private async enforceRateLimit(req: RequestWithIp): Promise<void> {
    const ip =
      (typeof req.headers?.['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : req.ip) || '127.0.0.1';
    const key = hashRateLimitKey('emp:public-qr', ip);
    const result = await consumeSqlRateLimit(this.prisma, key, 60, 60_000);
    if (!result.allowed) {
      throwEmployeeError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Muitas consultas de verificação. Tente novamente em instantes.',
      );
    }
  }

  @Get(':qrcode')
  @Header('Cache-Control', 'no-store')
  async verify(
    @Param('qrcode') qrcode: string,
    @Req() req: RequestWithIp,
  ): Promise<PublicEmployeeVerificationResponse> {
    await this.enforceRateLimit(req);

    const employee = await this.repository.findByQrcode(qrcode);
    if (!employee) {
      throwEmployeeError(
        HttpStatus.NOT_FOUND,
        'QR_NOT_FOUND',
        'QR Code não encontrado.',
      );
    }

    const evaluation = this.eligibility.evaluate(
      employee,
      employee.assignments ?? [],
      employee.photos ?? [],
    );

    if (!evaluation.cardEligible) {
      return {
        valid: false,
        profileType: 'EMPLOYEE',
        reasonCode: evaluation.reasonCode ?? 'NO_ACTIVE_ASSIGNMENT',
        checkedAt: evaluation.checkedAt,
      };
    }

    return {
      valid: true,
      profileType: 'EMPLOYEE',
      displayName: this.mapper.getDisplayName(employee),
      activeAssignments: evaluation.activeAssignments.map((a) => ({
        title: a.title,
      })),
      validityKind:
        evaluation.validityKind === 'UNTIL_DATE'
          ? 'UNTIL_DATE'
          : 'INDETERMINATE',
      validUntil: evaluation.validUntil,
      photoUrl: `/funcionarios/verificar/${encodeURIComponent(qrcode)}/foto`,
      checkedAt: evaluation.checkedAt,
    };
  }

  @Get(':qrcode/foto')
  @Header('Cache-Control', 'no-store')
  async verifyPhoto(
    @Param('qrcode') qrcode: string,
    @Req() req: RequestWithIp,
    @Res() res: Response,
  ) {
    await this.enforceRateLimit(req);

    const employee = await this.repository.findByQrcode(qrcode);
    if (!employee) {
      throwEmployeeError(
        HttpStatus.NOT_FOUND,
        'QR_NOT_FOUND',
        'QR Code não encontrado.',
      );
    }

    const evaluation = this.eligibility.evaluate(
      employee,
      employee.assignments ?? [],
      employee.photos ?? [],
    );

    if (!evaluation.cardEligible || !evaluation.approvedPhotoId) {
      throwEmployeeError(
        HttpStatus.NOT_FOUND,
        'PHOTO_NOT_FOUND',
        'Foto pública indisponível para esta credencial.',
      );
    }

    const { buffer, contentType } = await this.photoService.getPhotoContent(
      employee.id,
      evaluation.approvedPhotoId,
    );
    res.setHeader('Content-Type', contentType);
    return res.send(buffer);
  }
}
