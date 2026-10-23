import { ConflictException, BadRequestException } from '@nestjs/common';
import { EventOperationsService } from './event-operations.service';
import { PrismaService } from '../database/prisma.service';
import { CertificateService } from '../certificate/certificate.service';
import { EventStorageService } from './event-storage.service';

interface AuditRecord {
  secretaryId?: number;
  action?: string;
  reason?: string;
  [key: string]: unknown;
}

interface MockArtifact {
  id: string;
  certificateId: string;
  certificate: {
    id: string;
    eventId: string;
    revokedAt: Date | null;
    event: { status: string };
  };
  state: string;
  deliveryState: string;
  deliveryAttempts: number;
  leaseToken: string | null;
  leaseUntil: Date | null;
}

describe('EventOperationsService - Reconciliação Concorrente de Entregas (C1)', () => {
  let operationsService: EventOperationsService;

  it('deve rejeitar com HTTP 409 solicitação desatualizada quando dois administradores concorrem', async () => {
    const cert = {
      id: 'cert-1',
      eventId: 'event-1',
      revokedAt: null,
      event: { status: 'COMPLETED' },
    };
    const artifact: MockArtifact = {
      id: 'art-1',
      certificateId: cert.id,
      certificate: cert,
      state: 'READY',
      deliveryState: 'AMBIGUOUS',
      deliveryAttempts: 1,
      leaseToken: null,
      leaseUntil: null,
    };

    let releaseSecondRead: () => void = () => {};
    let announceSecondRead: () => void = () => {};
    const secondReadReady = new Promise<void>((resolve) => {
      announceSecondRead = resolve;
    });
    const secondReadGate = new Promise<void>((resolve) => {
      releaseSecondRead = resolve;
    });
    let reads = 0;
    const auditEntries: AuditRecord[] = [];

    const mockPrisma = {
      $transaction: <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
        cb(mockPrisma),
      certificateArtifact: {
        findUnique: jest.fn().mockImplementation(async () => {
          const snap = JSON.parse(JSON.stringify(artifact)) as MockArtifact;
          if (++reads === 2) {
            announceSecondRead();
            await secondReadGate;
          }
          return snap;
        }),
        updateMany: jest
          .fn()
          .mockImplementation(
            ({
              where,
              data,
            }: {
              where: Record<string, unknown>;
              data: Record<string, unknown>;
            }) => {
              if (
                where.id === artifact.id &&
                where.deliveryState === artifact.deliveryState &&
                where.deliveryAttempts === artifact.deliveryAttempts &&
                (where.leaseToken === artifact.leaseToken ||
                  (where.leaseToken === null && artifact.leaseToken === null))
              ) {
                Object.assign(artifact, data);
                return Promise.resolve({ count: 1 });
              }
              return Promise.resolve({ count: 0 });
            },
          ),
      },
      eventAudit: {
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: AuditRecord }) => {
            auditEntries.push(data);
            return Promise.resolve(data);
          }),
      },
    };

    operationsService = new EventOperationsService(
      mockPrisma as unknown as PrismaService,
      {} as CertificateService,
      {} as EventStorageService,
    );

    const first = operationsService.reconcileDelivery(
      cert.id,
      {
        resolution: 'RESCHEDULE_SEND',
        reason: 'Primeiro operador confirmou reagendamento',
      },
      1,
    );
    const second = operationsService.reconcileDelivery(
      cert.id,
      {
        resolution: 'CONFIRM_SENT',
        reason: 'Segundo operador com leitura defasada',
      },
      2,
    );

    await secondReadReady;
    const res1 = await first;
    expect(res1.success).toBe(true);
    expect(artifact.deliveryState).toBe('PENDING');

    // Desbloqueia a segunda leitura após a primeira ter concluído
    releaseSecondRead();

    await expect(second).rejects.toThrow(ConflictException);
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].reason).toContain('Primeiro operador');
  });

  it('nunca deve sobrescrever lease ativo ou estado DISPATCHING de worker', async () => {
    const cert = {
      id: 'cert-2',
      eventId: 'event-2',
      revokedAt: null,
      event: { status: 'COMPLETED' },
    };
    const artifact: MockArtifact = {
      id: 'art-2',
      certificateId: cert.id,
      certificate: cert,
      state: 'READY',
      deliveryState: 'AMBIGUOUS',
      deliveryAttempts: 1,
      leaseToken: null,
      leaseUntil: null,
    };

    let releaseSecondRead: () => void = () => {};
    let announceSecondRead: () => void = () => {};
    const secondReadReady = new Promise<void>((resolve) => {
      announceSecondRead = resolve;
    });
    const secondReadGate = new Promise<void>((resolve) => {
      releaseSecondRead = resolve;
    });
    let reads = 0;
    const auditEntries: AuditRecord[] = [];

    const mockPrisma = {
      $transaction: <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
        cb(mockPrisma),
      certificateArtifact: {
        findUnique: jest.fn().mockImplementation(async () => {
          const snap = JSON.parse(JSON.stringify(artifact)) as MockArtifact;
          if (++reads === 1) {
            announceSecondRead();
            await secondReadGate;
          }
          return snap;
        }),
        updateMany: jest
          .fn()
          .mockImplementation(
            ({
              where,
              data,
            }: {
              where: Record<string, unknown>;
              data: Record<string, unknown>;
            }) => {
              if (
                where.id === artifact.id &&
                where.deliveryState === artifact.deliveryState &&
                where.deliveryAttempts === artifact.deliveryAttempts &&
                where.leaseToken === artifact.leaseToken
              ) {
                Object.assign(artifact, data);
                return Promise.resolve({ count: 1 });
              }
              return Promise.resolve({ count: 0 });
            },
          ),
      },
      eventAudit: {
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: AuditRecord }) => {
            auditEntries.push(data);
            return Promise.resolve(data);
          }),
      },
    };

    operationsService = new EventOperationsService(
      mockPrisma as unknown as PrismaService,
      {} as CertificateService,
      {} as EventStorageService,
    );

    const reconcilePromise = operationsService.reconcileDelivery(
      cert.id,
      {
        resolution: 'RESCHEDULE_SEND',
        reason: 'Tentativa de reconciliação enquanto worker assume',
      },
      1,
    );

    await secondReadReady;

    // Worker assume o job enquanto a transação do admin estava em andamento
    artifact.deliveryState = 'DISPATCHING';
    artifact.leaseToken = 'worker-lease-abc-123';
    artifact.leaseUntil = new Date(Date.now() + 120000);

    releaseSecondRead();

    await expect(reconcilePromise).rejects.toThrow(ConflictException);

    // O lease e estado DISPATCHING do worker NÃO foram apagados
    expect(artifact.deliveryState).toBe('DISPATCHING');
    expect(artifact.leaseToken).toBe('worker-lease-abc-123');
    expect(auditEntries).toHaveLength(0);
  });

  it('deve rejeitar reconciliação se o evento for cancelado ou o certificado revogado concorrentemente', async () => {
    const cert = {
      id: 'cert-3',
      eventId: 'event-3',
      revokedAt: null,
      event: { status: 'CANCELLED' }, // Evento cancelado
    };
    const artifact: MockArtifact = {
      id: 'art-3',
      certificateId: cert.id,
      certificate: cert,
      state: 'READY',
      deliveryState: 'AMBIGUOUS',
      deliveryAttempts: 1,
      leaseToken: null,
      leaseUntil: null,
    };

    const mockPrisma = {
      $transaction: <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
        cb(mockPrisma),
      certificateArtifact: {
        findUnique: jest.fn().mockResolvedValue(artifact),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      eventAudit: { create: jest.fn() },
    };

    operationsService = new EventOperationsService(
      mockPrisma as unknown as PrismaService,
      {} as CertificateService,
      {} as EventStorageService,
    );

    await expect(
      operationsService.reconcileDelivery(
        cert.id,
        { resolution: 'CONFIRM_SENT', reason: 'Tentativa em evento cancelado' },
        1,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('deve aceitar as três resoluções legítimas e gravar auditoria em transação única', async () => {
    for (const resolution of [
      'CONFIRM_SENT',
      'RESCHEDULE_SEND',
      'KEEP_AMBIGUOUS',
    ] as const) {
      const cert = {
        id: `cert-${resolution}`,
        eventId: 'event-4',
        revokedAt: null,
        event: { status: 'COMPLETED' },
      };
      const artifact: MockArtifact = {
        id: `art-${resolution}`,
        certificateId: cert.id,
        certificate: cert,
        state: 'READY',
        deliveryState: 'AMBIGUOUS',
        deliveryAttempts: 2,
        leaseToken: null,
        leaseUntil: null,
      };

      const auditLog: AuditRecord[] = [];
      const mockPrisma = {
        $transaction: <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
          cb(mockPrisma),
        certificateArtifact: {
          findUnique: jest.fn().mockResolvedValue(artifact),
          updateMany: jest
            .fn()
            .mockImplementation(
              ({ data }: { data: Record<string, unknown> }) => {
                Object.assign(artifact, data);
                return Promise.resolve({ count: 1 });
              },
            ),
        },
        eventAudit: {
          create: jest
            .fn()
            .mockImplementation(({ data }: { data: AuditRecord }) => {
              auditLog.push(data);
              return Promise.resolve(data);
            }),
        },
      };

      const service = new EventOperationsService(
        mockPrisma as unknown as PrismaService,
        {} as CertificateService,
        {} as EventStorageService,
      );

      const res = await service.reconcileDelivery(
        cert.id,
        { resolution, reason: `Reconciliação válida para ${resolution}` },
        10,
      );

      expect(res.success).toBe(true);
      expect(res.resolution).toBe(resolution);
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0].secretaryId).toBe(10);
      expect(auditLog[0].reason).toContain(resolution);

      if (resolution === 'CONFIRM_SENT') {
        expect(artifact.deliveryState).toBe('SENT');
      } else if (resolution === 'RESCHEDULE_SEND') {
        expect(artifact.deliveryState).toBe('PENDING');
        expect(artifact.deliveryAttempts).toBe(0);
      } else {
        expect(artifact.deliveryState).toBe('AMBIGUOUS');
      }
    }
  });

  it('deve validar razão com mínimo de 5 caracteres', async () => {
    const service = new EventOperationsService(
      {} as PrismaService,
      {} as CertificateService,
      {} as EventStorageService,
    );

    await expect(
      service.reconcileDelivery(
        'id',
        { resolution: 'CONFIRM_SENT', reason: 'abc' },
        1,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
