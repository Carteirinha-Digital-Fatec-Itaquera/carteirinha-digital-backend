import { JwtService } from '@nestjs/jwt';
import { CheckpointType } from '@prisma/client';
import type { AttendanceQrReferenceService } from '../attendance/attendance-qr-reference.service';
import { QrTokenService } from './qr-token.service';

describe('QrTokenService', () => {
  const previousJwtSecret = process.env.JWT_SECRET;
  const previousQrSecret = process.env.ATTENDANCE_QR_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = 'login-secret-for-tests';
    process.env.ATTENDANCE_QR_SECRET = 'attendance-secret-for-tests';
  });

  afterAll(() => {
    process.env.JWT_SECRET = previousJwtSecret;
    process.env.ATTENDANCE_QR_SECRET = previousQrSecret;
  });

  it('assina com segredo QR, validade operacional e claims mínimos', async () => {
    const jwt = new JwtService();
    const service = new QrTokenService(jwt);

    const response = await service.generate({
      eventId: 'event-id',
      checkpoint: CheckpointType.CHECK_IN,
      checkpointVersion: 7,
    });

    expect(response.expiresInSeconds).toBe(900);
    expect(response.checkpointVersion).toBe(7);

    const payload = await jwt.verifyAsync<Record<string, unknown>>(
      response.qrToken,
      { secret: process.env.ATTENDANCE_QR_SECRET },
    );

    expect(payload.eventId).toBe('event-id');
    expect(payload.checkpoint).toBe(CheckpointType.CHECK_IN);
    expect(payload.checkpointVersion).toBe(7);
    expect(typeof payload.jti).toBe('string');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    expect(Number(payload.exp) - Number(payload.iat)).toBe(900);

    for (const pii of ['ra', 'cpf', 'email', 'name']) {
      expect(payload).not.toHaveProperty(pii);
    }
  });

  it('continua válido após 20 segundos e termina junto da janela', async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const jwt = new JwtService();
      const service = new QrTokenService(jwt);
      const closesAt = new Date(now + 120000);
      const response = await service.generate({
        eventId: 'event-id',
        checkpoint: CheckpointType.CHECK_IN,
        checkpointVersion: 2,
        closesAt,
      });
      clock.mockReturnValue(now + 21000);
      await expect(
        jwt.verifyAsync(response.qrToken, {
          secret: process.env.ATTENDANCE_QR_SECRET,
        }),
      ).resolves.toHaveProperty('eventId', 'event-id');
      expect(Date.parse(response.expiresAt)).toBeLessThanOrEqual(
        closesAt.getTime(),
      );
      clock.mockReturnValue(now + 120000);
      await expect(
        jwt.verifyAsync(response.qrToken, {
          secret: process.env.ATTENDANCE_QR_SECRET,
        }),
      ).rejects.toThrow();
      await expect(
        service.generate({
          eventId: 'event-id',
          checkpoint: CheckpointType.CHECK_IN,
          checkpointVersion: 2,
          closesAt,
        }),
      ).rejects.toThrow();
    } finally {
      clock.mockRestore();
    }
  });

  it('respeita a janela mesmo com expiresIn padrão do módulo de autenticação', async () => {
    const jwt = new JwtService({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1h' },
    });
    const service = new QrTokenService(jwt);
    const closesAt = new Date(Date.now() + 120000);
    const response = await service.generate({
      eventId: 'event-id',
      checkpoint: CheckpointType.CHECK_IN,
      checkpointVersion: 2,
      closesAt,
    });
    const qrClaims = await jwt.verifyAsync<{ exp: number; iat: number }>(
      response.qrToken,
      { secret: process.env.ATTENDANCE_QR_SECRET },
    );
    expect(qrClaims.exp * 1000).toBeLessThanOrEqual(closesAt.getTime());
    expect(qrClaims.exp - qrClaims.iat).toBeLessThanOrEqual(120);
    const loginClaims = await jwt.verifyAsync<{ exp: number; iat: number }>(
      await jwt.signAsync({ sub: 'test-student' }),
    );
    expect(loginClaims.exp - loginClaims.iat).toBe(3600);
  });

  it('não valida o QR usando JWT_SECRET de login', async () => {
    const jwt = new JwtService();
    const service = new QrTokenService(jwt);

    const response = await service.generate({
      eventId: 'event-id',
      checkpoint: CheckpointType.CHECK_OUT,
      checkpointVersion: 3,
    });

    await expect(
      jwt.verifyAsync(response.qrToken, {
        secret: process.env.JWT_SECRET,
      }),
    ).rejects.toThrow();
  });

  it('retorna expiresAt compatível com exp do token', async () => {
    const jwt = new JwtService();
    const service = new QrTokenService(jwt);

    const response = await service.generate({
      eventId: 'event-id',
      checkpoint: CheckpointType.CHECK_IN,
      checkpointVersion: 2,
    });
    const payload = await jwt.verifyAsync<{ exp: number }>(response.qrToken, {
      secret: process.env.ATTENDANCE_QR_SECRET,
    });

    expect(response.expiresAt).toBe(new Date(payload.exp * 1000).toISOString());
  });

  it('gera qrUrl e serverTime quando AttendanceQrReferenceService e checkpointId são fornecidos', async () => {
    const jwt = new JwtService();
    const mockRefService = {
      createReference: jest.fn().mockResolvedValue({
        reference: 'short-ref-1234567890',
        expiresAt: new Date(),
      }),
      buildQrUrl: jest
        .fn()
        .mockReturnValue(
          'https://carteirinha-digital-front-end-aluno.vercel.app/p/short-ref-1234567890',
        ),
    };
    const service = new QrTokenService(
      jwt,
      mockRefService as unknown as AttendanceQrReferenceService,
    );

    const response = await service.generate({
      eventId: 'event-id',
      checkpoint: CheckpointType.CHECK_IN,
      checkpointVersion: 2,
      checkpointId: 'checkpoint-id',
    });

    expect(response.qrUrl).toBe(
      'https://carteirinha-digital-front-end-aluno.vercel.app/p/short-ref-1234567890',
    );
    expect(typeof response.serverTime).toBe('string');
    expect(mockRefService.createReference).toHaveBeenCalledWith({
      checkpointId: 'checkpoint-id',
      checkpointVersion: 2,
      jwtToken: response.qrToken,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expiresAt: expect.any(Date),
    });
  });
});
