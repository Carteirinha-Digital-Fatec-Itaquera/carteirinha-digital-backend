import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { AttendanceQrReferenceService } from './attendance-qr-reference.service';
import { PrismaService } from '../database/prisma.service';

describe('AttendanceQrReferenceService', () => {
  let service: AttendanceQrReferenceService;
  let prisma: {
    attendanceQrReference: {
      create: jest.Mock;
      findUnique: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      attendanceQrReference: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    service = new AttendanceQrReferenceService(prisma as unknown as PrismaService);
  });

  describe('createReference', () => {
    it('creates a 22-character base64url reference and stores SHA-256 hash', async () => {
      const expiresAt = new Date(Date.now() + 20000);
      prisma.attendanceQrReference.create.mockResolvedValue({
        id: 'ref-1',
        referenceHash: 'mock-hash',
        checkpointId: 'cp-1',
        checkpointVersion: 1,
        jwtToken: 'jwt-token-123',
        expiresAt,
        createdAt: new Date(),
      });

      const result = await service.createReference({
        checkpointId: 'cp-1',
        checkpointVersion: 1,
        jwtToken: 'jwt-token-123',
        expiresAt,
      });

      expect(result.reference).toHaveLength(22);
      expect(result.expiresAt).toEqual(expiresAt);

      const expectedHash = createHash('sha256').update(result.reference).digest('hex');
      expect(prisma.attendanceQrReference.create).toHaveBeenCalledWith({
        data: {
          referenceHash: expectedHash,
          checkpointId: 'cp-1',
          checkpointVersion: 1,
          jwtToken: 'jwt-token-123',
          expiresAt,
        },
      });
    });
  });

  describe('resolveReference', () => {
    it('throws EXPIRED_OR_INVALID_QR if reference is not found in database', async () => {
      prisma.attendanceQrReference.findUnique.mockResolvedValue(null);

      await expect(service.resolveReference('unknown-ref-1234567890')).rejects.toThrow(
        BadRequestException,
      );

      try {
        await service.resolveReference('unknown-ref-1234567890');
      } catch (err) {
        expect((err as BadRequestException).getResponse()).toEqual({
          statusCode: 400,
          error: 'Bad Request',
          code: 'EXPIRED_OR_INVALID_QR',
          message: 'QR Code expirado ou inválido. Faça uma nova leitura.',
        });
      }
    });

    it('throws EXPIRED_OR_INVALID_QR if reference has expired', async () => {
      const expiredDate = new Date(Date.now() - 5000); // 5s in the past
      prisma.attendanceQrReference.findUnique.mockResolvedValue({
        id: 'ref-1',
        referenceHash: 'some-hash',
        checkpointId: 'cp-1',
        checkpointVersion: 1,
        jwtToken: 'jwt-token-123',
        expiresAt: expiredDate,
        checkpoint: {
          id: 'cp-1',
          isOpen: true,
          version: 1,
          event: { id: 'ev-1', status: 'IN_PROGRESS' },
        },
      });

      await expect(service.resolveReference('expired-ref-1234567890')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws CHECKPOINT_CLOSED if checkpoint is closed or version mismatch', async () => {
      const validDate = new Date(Date.now() + 15000);
      prisma.attendanceQrReference.findUnique.mockResolvedValue({
        id: 'ref-1',
        referenceHash: 'some-hash',
        checkpointId: 'cp-1',
        checkpointVersion: 1,
        jwtToken: 'jwt-token-123',
        expiresAt: validDate,
        checkpoint: {
          id: 'cp-1',
          isOpen: false, // Closed!
          version: 2, // Version changed!
          event: { id: 'ev-1', status: 'IN_PROGRESS' },
        },
      });

      await expect(service.resolveReference('closed-ref-1234567890')).rejects.toThrow(
        BadRequestException,
      );

      try {
        await service.resolveReference('closed-ref-1234567890');
      } catch (err) {
        expect((err as BadRequestException).getResponse()).toEqual({
          statusCode: 400,
          error: 'Bad Request',
          code: 'CHECKPOINT_CLOSED',
          message: 'Checkpoint fechado ou alterado. Faça uma nova leitura.',
        });
      }
    });

    it('returns record when valid and active', async () => {
      const validDate = new Date(Date.now() + 15000);
      const record = {
        id: 'ref-1',
        referenceHash: 'some-hash',
        checkpointId: 'cp-1',
        checkpointVersion: 1,
        jwtToken: 'jwt-token-123',
        expiresAt: validDate,
        checkpoint: {
          id: 'cp-1',
          type: 'CHECK_IN',
          isOpen: true,
          version: 1,
          event: {
            id: 'ev-1',
            title: 'Palestra de IA',
            speaker: 'Dr. Turing',
            location: 'Auditório Principal',
            status: 'IN_PROGRESS',
          },
        },
      };
      prisma.attendanceQrReference.findUnique.mockResolvedValue(record);

      const resolved = await service.resolveReference('valid-ref-123456789012');
      expect(resolved).toEqual(record);
    });
  });

  describe('buildQrUrl', () => {
    it('builds student app url with /p/<reference>', () => {
      const url = service.buildQrUrl('abc123xyz');
      expect(url).toBe('https://carteirinha-digital-front-end-aluno.vercel.app/p/abc123xyz');
    });
  });
});
