import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CheckpointType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { loadAuthSecrets } from '../auth/auth.config';
import { AttendanceQrReferenceService } from '../attendance/attendance-qr-reference.service';

interface QrTokenPayload {
  eventId: string;
  checkpoint: CheckpointType;
  checkpointVersion: number;
  checkpointId?: string;
  closesAt?: Date | null;
}

@Injectable()
export class QrTokenService {
  private readonly attendanceQrSecret: string;

  constructor(
    private readonly jwtService: JwtService,
    @Optional()
    private readonly attendanceQrReferenceService?: AttendanceQrReferenceService,
  ) {
    this.attendanceQrSecret = loadAuthSecrets().attendanceQrSecret;
  }

  async generate(payload: QrTokenPayload) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresInSeconds = payload.closesAt
      ? Math.floor(payload.closesAt.getTime() / 1000) - issuedAt
      : null;
    if (
      expiresInSeconds !== null &&
      (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0)
    ) {
      throw new BadRequestException('A janela de presença já foi encerrada.');
    }
    const expDate =
      expiresInSeconds === null
        ? null
        : new Date((issuedAt + expiresInSeconds) * 1000);
    // O QR manual não herda o prazo da sessão de login.
    const signer =
      expiresInSeconds === null ? new JwtService() : this.jwtService;
    const qrToken = await signer.signAsync(
      {
        eventId: payload.eventId,
        checkpoint: payload.checkpoint,
        checkpointVersion: payload.checkpointVersion,
        iat: issuedAt,
        ...(expiresInSeconds === null ? { manual: true } : {}),
      },
      {
        secret: this.attendanceQrSecret,
        ...(expiresInSeconds === null ? {} : { expiresIn: expiresInSeconds }),
        jwtid: randomUUID(),
      },
    );

    let qrUrl: string | undefined;

    if (this.attendanceQrReferenceService && payload.checkpointId) {
      const refResult = await this.attendanceQrReferenceService.createReference(
        {
          checkpointId: payload.checkpointId,
          checkpointVersion: payload.checkpointVersion,
          jwtToken: qrToken,
          expiresAt: expDate,
        },
      );
      qrUrl = this.attendanceQrReferenceService.buildQrUrl(refResult.reference);
    }

    return {
      qrToken,
      expiresInSeconds,
      expiresAt: expDate?.toISOString() ?? null,
      checkpointVersion: payload.checkpointVersion,
      ...(qrUrl ? { qrUrl } : {}),
      serverTime: new Date().toISOString(),
    };
  }
}
