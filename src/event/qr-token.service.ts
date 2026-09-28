import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CheckpointType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { loadAuthSecrets } from '../auth/auth.config';

interface QrTokenPayload {
  eventId: string;
  checkpoint: CheckpointType;
  checkpointVersion: number;
}

@Injectable()
export class QrTokenService {
  static readonly EXPIRES_IN_SECONDS = 20;
  private readonly attendanceQrSecret: string;

  constructor(private readonly jwtService: JwtService) {
    this.attendanceQrSecret = loadAuthSecrets().attendanceQrSecret;
  }

  async generate(payload: QrTokenPayload) {
    const qrToken = await this.jwtService.signAsync(payload, {
      secret: this.attendanceQrSecret,
      expiresIn: QrTokenService.EXPIRES_IN_SECONDS,
      jwtid: randomUUID(),
    });

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

    return {
      qrToken,
      expiresInSeconds: QrTokenService.EXPIRES_IN_SECONDS as 20,
      expiresAt: new Date(decoded.exp * 1000).toISOString(),
      checkpointVersion: payload.checkpointVersion,
    };
  }
}
