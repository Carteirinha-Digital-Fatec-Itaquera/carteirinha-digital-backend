import { JwtService } from '@nestjs/jwt';
import { CheckpointType } from '@prisma/client';
import { QrTokenService } from './qr-token.service';
import type { AttendanceQrReferenceService } from '../attendance/attendance-qr-reference.service';

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

  it('assina com segredo QR, TTL de 20s e claims mínimos', async () => {
    const jwt = new JwtService();
    const service = new QrTokenService(jwt);

    const response = await service.generate({
      eventId: 'event-id',
      checkpoint: CheckpointType.CHECK_IN,
      checkpointVersion: 7,
    });

    expect(response.expiresInSeconds).toBe(20);
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
    expect(Number(payload.exp) - Number(payload.iat)).toBe(20);

    for (const pii of ['ra', 'cpf', 'email', 'name']) {
      expect(payload).not.toHaveProperty(pii);
    }
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
    expect(mockRefService.createReference).toHaveBeenCalledTimes(1);
    const [callArg] = mockRefService.createReference.mock.calls[0] as [
      {
        checkpointId: string;
        checkpointVersion: number;
        jwtToken: string;
        expiresAt: unknown;
      },
    ];
    expect(callArg.checkpointId).toBe('checkpoint-id');
    expect(callArg.checkpointVersion).toBe(2);
    expect(callArg.jwtToken).toBe(response.qrToken);
    expect(callArg.expiresAt).toBeInstanceOf(Date);
  });

  it('generationReturnsReferenceUrlAndServerTime: retorna qrUrl com 22 chars, serverTime e expiração coerente', async () => {
    const jwt = new JwtService();
    const mockRefService = {
      createReference: jest
        .fn()
        .mockImplementation(({ expiresAt }: { expiresAt: Date }) => ({
          reference: '1234567890123456789012',
          expiresAt,
        })),
      buildQrUrl: jest
        .fn()
        .mockReturnValue(
          'https://carteirinha-digital-front-end-aluno.vercel.app/p/1234567890123456789012',
        ),
    };
    const service = new QrTokenService(
      jwt,
      mockRefService as unknown as AttendanceQrReferenceService,
    );

    const before = Date.now();
    const response = await service.generate({
      eventId: 'event-id',
      checkpoint: CheckpointType.CHECK_IN,
      checkpointVersion: 2,
      checkpointId: 'checkpoint-id',
    });
    const after = Date.now();

    expect(response.qrUrl).toBe(
      'https://carteirinha-digital-front-end-aluno.vercel.app/p/1234567890123456789012',
    );
    expect(response.serverTime).toBeDefined();
    const serverTimeMs = new Date(String(response.serverTime)).getTime();
    expect(serverTimeMs).toBeGreaterThanOrEqual(before - 1000);
    expect(serverTimeMs).toBeLessThanOrEqual(after + 1000);
    expect(response.expiresAt).toBeDefined();
    const expMs = new Date(response.expiresAt).getTime();
    expect(expMs - serverTimeMs).toBeGreaterThanOrEqual(18000);
    expect(expMs - serverTimeMs).toBeLessThanOrEqual(21000);
  });

  it('generationDoesNotSilentlyOmitRequiredReferenceService: falha explicitamente se checkpointId for fornecido sem serviço de referência', async () => {
    const jwt = new JwtService();
    const service = new QrTokenService(jwt);

    await expect(
      service.generate({
        eventId: 'event-id',
        checkpoint: CheckpointType.CHECK_IN,
        checkpointVersion: 2,
        checkpointId: 'checkpoint-id',
      }),
    ).rejects.toThrow('Serviço de referência de QR');
  });
});
