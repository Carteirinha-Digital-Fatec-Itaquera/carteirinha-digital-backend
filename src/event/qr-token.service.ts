import { Injectable, InternalServerErrorException, Optional } from '@nestjs/common';
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
}

@Injectable()
export class QrTokenService {
  static readonly EXPIRES_IN_SECONDS = 20;
  private readonly attendanceQrSecret: string;

  constructor(
    private readonly jwtService: JwtService,
    @Optional()
    private readonly attendanceQrReferenceService?: AttendanceQrReferenceService,
  ) {
    this.attendanceQrSecret = loadAuthSecrets().attendanceQrSecret;
  }

  async generate(payload: QrTokenPayload) {
    const qrToken = await this.jwtService.signAsync(
      {
        eventId: payload.eventId,
        checkpoint: payload.checkpoint,
        checkpointVersion: payload.checkpointVersion,
      },
      {
        secret: this.attendanceQrSecret,
        expiresIn: QrTokenService.EXPIRES_IN_SECONDS,
        jwtid: randomUUID(),
      },
    );

    const decoded: unknown = this.jwtService.decode(qrToken);
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      !('exp' in decoded) ||
      typeof decoded.exp !== 'number'
    ) {
      throw new InternalServerErrorException(
        'Não foi possível determinar a expiração do QR',
      );
    }

    const expDate = new Date(decoded.exp * 1000);
    let qrUrl: string | undefined;

    if (this.attendanceQrReferenceService && payload.checkpointId) {
      const refResult = await this.attendanceQrReferenceService.createReference({
        checkpointId: payload.checkpointId,
        checkpointVersion: payload.checkpointVersion,
        jwtToken: qrToken,
        expiresAt: expDate,
      });
      qrUrl = this.attendanceQrReferenceService.buildQrUrl(refResult.reference);
    }

    return {
      qrToken,
      expiresInSeconds: QrTokenService.EXPIRES_IN_SECONDS as 20,
      expiresAt: expDate.toISOString(),
      checkpointVersion: payload.checkpointVersion,
      ...(qrUrl ? { qrUrl } : {}),
      serverTime: new Date().toISOString(),
    };
  }
}
