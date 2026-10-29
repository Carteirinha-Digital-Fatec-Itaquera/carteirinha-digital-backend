import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { loadAuthSecrets } from '../auth/auth.config';
import { PrismaService } from '../database/prisma.service';

export interface CreateReferenceParams {
  checkpointId: string;
  checkpointVersion: number;
  jwtToken: string;
  expiresAt: Date | null;
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

  async permanentQr(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException('Evento não encontrado');
    if (event.status === 'CANCELLED')
      throw new BadRequestException('Evento cancelado');
    if (!event.attendancePublicReference) {
      await this.prisma.event.updateMany({
        where: { id: eventId, attendancePublicReference: null },
        data: {
          attendancePublicReference:
            'ev_' + randomBytes(16).toString('base64url'),
        },
      });
    }
    const current = await this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
    });
    return {
      qrUrl: this.buildQrUrl(current.attendancePublicReference!),
      permanent: true,
      checkpointVersion: 0,
      qrToken: '',
      expiresAt: null,
      expiresInSeconds: null,
      serverTime: new Date().toISOString(),
    };
  }

  async resolveReference(
    reference: string,
    client: Prisma.TransactionClient = this.prisma,
    allowClosedPreview = false,
  ) {
    if (
      !reference ||
      typeof reference !== 'string' ||
      !/^[A-Za-z0-9_-]{10,64}$/.test(reference)
    ) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'EXPIRED_OR_INVALID_QR',
        message: 'QR Code expirado ou inválido. Faça uma nova leitura.',
      });
    }

    if (/^ev_[A-Za-z0-9_-]{22}$/.test(reference)) {
      const event = await client.event.findUnique({
        where: { attendancePublicReference: reference },
        include: { checkpoints: true },
      });
      if (!event || event.status === 'CANCELLED')
        throw new BadRequestException({
          code: 'EVENT_CANCELLED',
          message: 'Evento indisponível.',
        });
      const checkpoint = event.checkpoints.find(
        (cp) => cp.type === 'CHECK_OUT',
      );
      if (!checkpoint)
        throw new BadRequestException({
          code: 'CHECKPOINT_CLOSED',
          message: 'Registro de presença ainda não disponível.',
        });
      const available =
        checkpoint.isOpen &&
        event.status === 'IN_PROGRESS' &&
        (!checkpoint.closesAt || checkpoint.closesAt.getTime() > Date.now());
      if (!available && !allowClosedPreview)
        throw new BadRequestException({
          code: 'CHECKPOINT_CLOSED',
          message:
            'O registro de presença está fechado. Aguarde a organização liberar.',
        });
      // The public link identifies the event; AttendanceService rechecks this version under its existing locks.
      const jwtToken = available
        ? await new JwtService().signAsync(
            {
              eventId: event.id,
              checkpoint: 'CHECK_OUT',
              checkpointVersion: checkpoint.version,
              manual: true,
            },
            {
              secret: loadAuthSecrets().attendanceQrSecret,
              jwtid: randomUUID(),
            },
          )
        : '';
      return {
        id: event.id,
        referenceHash: this.hashReference(reference),
        checkpointId: checkpoint.id,
        checkpointVersion: checkpoint.version,
        jwtToken,
        expiresAt: null,
        createdAt: event.createdAt,
        checkpoint: { ...checkpoint, event },
        permanent: true,
        available,
      };
    }
    const referenceHash = this.hashReference(reference);
    const record = await client.attendanceQrReference.findUnique({
      where: { referenceHash },
      include: {
        checkpoint: {
          include: {
            event: true,
          },
        },
      },
    });

    if (
      !record ||
      (record.expiresAt && record.expiresAt.getTime() <= Date.now())
    ) {
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
      (record.checkpoint.closesAt &&
        record.checkpoint.closesAt <= new Date()) ||
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

    return { ...record, permanent: false, available: true };
  }
}
