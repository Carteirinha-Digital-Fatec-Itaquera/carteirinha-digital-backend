import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';

export interface CreateReferenceParams {
  checkpointId: string;
  checkpointVersion: number;
  jwtToken: string;
  expiresAt: Date;
}

@Injectable()
export class AttendanceQrReferenceService {
  private readonly studentAppUrl: string;

  static validateConfiguredOrigin(rawUrl?: string): string {
    const candidate =
      rawUrl?.trim() ||
      'https://carteirinha-digital-front-end-aluno.vercel.app';

    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error(`Origem inválida para STUDENT_APP_URL: ${candidate}`);
    }

    if (parsed.username || parsed.password) {
      throw new Error('STUDENT_APP_URL não pode conter credenciais');
    }

    if (
      (parsed.search && parsed.search !== '') ||
      (parsed.hash && parsed.hash !== '')
    ) {
      throw new Error('STUDENT_APP_URL não pode conter query string ou hash');
    }

    const isProduction = process.env.NODE_ENV === 'production';
    if (parsed.protocol === 'https:') {
      // HTTPS sempre permitido
    } else if (parsed.protocol === 'http:') {
      if (isProduction) {
        throw new Error('STUDENT_APP_URL deve usar HTTPS em produção');
      }
      const isLoopback = ['localhost', '127.0.0.1'].includes(parsed.hostname);
      if (!isLoopback) {
        throw new Error(
          'STUDENT_APP_URL HTTP é permitido apenas em loopback (localhost/127.0.0.1) no desenvolvimento',
        );
      }
      if (!parsed.port) {
        throw new Error(
          'STUDENT_APP_URL HTTP em desenvolvimento exige porta explícita',
        );
      }
    } else {
      throw new Error(
        `Protocolo não autorizado em STUDENT_APP_URL: ${parsed.protocol}`,
      );
    }

    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(
      /\/+$/,
      '',
    );
  }

  constructor(private readonly prisma: PrismaService) {
    this.studentAppUrl = AttendanceQrReferenceService.validateConfiguredOrigin(
      process.env.STUDENT_APP_URL,
    );
  }

  hashReference(reference: string): string {
    return createHash('sha256').update(reference).digest('hex');
  }

  buildQrUrl(reference: string): string {
    if (!reference || typeof reference !== 'string') {
      throw new BadRequestException('Referência de QR inválida');
    }
    const base = this.studentAppUrl.replace(/\/+$/, '');
    return `${base}/p/${reference}`;
  }

  async createReference(params: CreateReferenceParams) {
    const reference = randomBytes(16).toString('base64url');
    const referenceHash = this.hashReference(reference);

    await this.prisma.attendanceQrReference.create({
      data: {
        referenceHash,
        checkpointId: params.checkpointId,
        checkpointVersion: params.checkpointVersion,
        jwtToken: params.jwtToken,
        expiresAt: params.expiresAt,
      },
    });

    return {
      reference,
      expiresAt: params.expiresAt,
    };
  }

  async resolveReference(reference: string) {
    if (!reference || typeof reference !== 'string' || reference.length < 10) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'EXPIRED_OR_INVALID_QR',
        message: 'QR Code expirado ou inválido. Faça uma nova leitura.',
      });
    }

    const referenceHash = this.hashReference(reference);
    const record = await this.prisma.attendanceQrReference.findUnique({
      where: { referenceHash },
      include: {
        checkpoint: {
          include: {
            event: true,
          },
        },
      },
    });

    if (!record || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'EXPIRED_OR_INVALID_QR',
        message: 'QR Code expirado ou inválido. Faça uma nova leitura.',
      });
    }

    if (
      !record.checkpoint ||
      !record.checkpoint.isOpen ||
      record.checkpoint.version !== record.checkpointVersion ||
      record.checkpoint.event.status === 'CANCELLED'
    ) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'CHECKPOINT_CLOSED',
        message: 'Checkpoint fechado ou alterado. Faça uma nova leitura.',
      });
    }

    return record;
  }
}
