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

  constructor(private readonly prisma: PrismaService) {
    this.studentAppUrl =
      process.env.STUDENT_APP_URL?.trim() ||
      'https://carteirinha-digital-front-end-aluno.vercel.app';
  }

  hashReference(reference: string): string {
    return createHash('sha256').update(reference).digest('hex');
  }

  buildQrUrl(reference: string): string {
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
