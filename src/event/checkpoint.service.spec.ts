import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CheckpointType, EventStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CheckpointService } from './checkpoint.service';

interface MockCheckpoint {
  id: string;
  eventId: string;
  type: CheckpointType;
  isOpen: boolean;
  version: number;
  openedAt: Date | null;
  closedAt: Date | null;
  closesAt: Date | null;
}

interface MockEvent {
  id: string;
  status: EventStatus;
  seriesId?: string | null;
  windowMinutes?: number | null;
  checkpoints: MockCheckpoint[];
}

function checkpoint(
  type: CheckpointType,
  overrides: Partial<MockCheckpoint> = {},
): MockCheckpoint {
  return {
    id: `${type}-id`,
    eventId: 'event-id',
    type,
    isOpen: false,
    version: 1,
    openedAt: null,
    closedAt: null,
    closesAt: null,
    ...overrides,
  };
}

function createPrisma(eventOverrides: Partial<MockEvent> = {}) {
  const checkpoints: MockCheckpoint[] = [
    checkpoint(CheckpointType.CHECK_IN),
    checkpoint(CheckpointType.CHECK_OUT),
  ];
  const event: MockEvent = {
    id: 'event-id',
    status: EventStatus.SCHEDULED,
    checkpoints,
    ...eventOverrides,
  };
  const audits: Array<{
    action: string;
    eventId: string;
    reason?: string;
    secretaryId?: number;
    createdAt: Date;
  }> = [];
  const state = {
    event,
    updatedEventStatus: undefined as EventStatus | undefined,
    updateManyCount: 1,
    audits,
  };

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    eventAudit: {
      create: jest.fn().mockImplementation(
        ({
          data,
        }: {
          data: {
            action: string;
            eventId: string;
            reason?: string;
            secretaryId?: number;
            createdAt?: Date;
          };
        }) => {
          const entry = {
            ...data,
            createdAt: data.createdAt || new Date(),
          };
          audits.push(entry);
          return entry;
        },
      ),
      findMany: jest.fn().mockImplementation(
        ({
          where,
        }: {
          where?: {
            eventId?: string;
            action?: string | { in: string[] };
          };
        } = {}) => {
          return audits.filter((a) => {
            if (where?.eventId && a.eventId !== where.eventId) return false;
            if (where?.action) {
              if (typeof where.action === 'string' && a.action !== where.action)
                return false;
              if (
                typeof where.action === 'object' &&
                'in' in where.action &&
                !where.action.in.includes(a.action)
              )
                return false;
            }
            return true;
          });
        },
      ),
    },
    event: {
      findUnique: jest.fn().mockImplementation(() => state.event),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: { status: EventStatus } }) => {
          state.updatedEventStatus = data.status;
          state.event.status = data.status;
          return state.event;
        }),
      updateMany: jest
        .fn()
        .mockImplementation(({ data }: { data: { status: EventStatus } }) => {
          state.updatedEventStatus = data.status;
          state.event.status = data.status;
          return { count: 1 };
        }),
    },
    eventCheckpoint: {
      updateMany: jest.fn().mockImplementation(
        ({
          where,
          data,
        }: {
          where: { id: string; isOpen?: boolean; version?: number };
          data: {
            isOpen: boolean;
            openedAt?: Date | null;
            closedAt?: Date | null;
            closesAt?: Date | null;
            version?: { increment: number };
          };
        }) => {
          const target = state.event.checkpoints.find(
            (item) => item.id === where.id,
          );
          if (state.updateManyCount === 1 && target) {
            target.isOpen = data.isOpen;
            if (data.openedAt !== undefined) target.openedAt = data.openedAt;
            if (data.closedAt !== undefined) target.closedAt = data.closedAt;
            if (data.closesAt !== undefined) target.closesAt = data.closesAt;
            target.version += 1;
          }
          return { count: state.updateManyCount };
        },
      ),
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          state.event.checkpoints.find((item) => item.id === where.id),
        ),
    },
  };

  const prisma = {
    $transaction: jest
      .fn()
      .mockImplementation((fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    event: {
      findUnique: jest.fn().mockImplementation(() => state.event),
    },
  };

  return { prisma: prisma as unknown as PrismaService, tx, state };
}

describe('CheckpointService', () => {
  it('abre CHECK_IN atomicamente, incrementa versão e inicia o evento', async () => {
    const { prisma, state } = createPrisma();
    const service = new CheckpointService(prisma);

    const result = await service.open('event-id', CheckpointType.CHECK_IN);

    expect(result.isOpen).toBe(true);
    expect(result.version).toBe(2);
    expect(state.updatedEventStatus).toBe(EventStatus.IN_PROGRESS);
  });

  it('retorna 409 ao repetir open em checkpoint já aberto', async () => {
    const { prisma, state, tx } = createPrisma({
      status: EventStatus.IN_PROGRESS,
    });
    state.event.checkpoints[0].isOpen = true;
    const service = new CheckpointService(prisma);

    await expect(
      service.open('event-id', CheckpointType.CHECK_IN),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.eventCheckpoint.updateMany).not.toHaveBeenCalled();
  });

  it('bloqueia CHECK_OUT antes do CHECK_IN estar encerrado', async () => {
    const { prisma, state } = createPrisma({
      status: EventStatus.IN_PROGRESS,
    });
    const checkIn = state.event.checkpoints[0];
    checkIn.isOpen = true;
    checkIn.openedAt = new Date();
    const service = new CheckpointService(prisma);

    await expect(
      service.open('event-id', CheckpointType.CHECK_OUT),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('abre CHECK_OUT após CHECK_IN fechado', async () => {
    const { prisma, state } = createPrisma({
      status: EventStatus.IN_PROGRESS,
    });
    const checkIn = state.event.checkpoints[0];
    checkIn.openedAt = new Date('2026-09-28T01:00:00.000Z');
    checkIn.closedAt = new Date('2026-09-28T01:10:00.000Z');
    const service = new CheckpointService(prisma);

    const result = await service.open('event-id', CheckpointType.CHECK_OUT);

    expect(result.type).toBe(CheckpointType.CHECK_OUT);
    expect(result.isOpen).toBe(true);
    expect(result.version).toBe(2);
  });

  it('fecha CHECK_OUT e conclui o evento', async () => {
    const { prisma, state } = createPrisma({
      status: EventStatus.IN_PROGRESS,
    });
    const checkOut = state.event.checkpoints[1];
    checkOut.isOpen = true;
    checkOut.openedAt = new Date();
    const service = new CheckpointService(prisma);
    const result = await service.close('event-id', CheckpointType.CHECK_OUT);

    expect(result.isOpen).toBe(false);
    expect(result.version).toBe(2);
    expect(state.updatedEventStatus).toBe(EventStatus.COMPLETED);
  });

  it('detecta corrida de versão e retorna 409', async () => {
    const { prisma, state } = createPrisma();
    state.updateManyCount = 0;
    const service = new CheckpointService(prisma);

    await expect(
      service.open('event-id', CheckpointType.CHECK_IN),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('não gera QR para checkpoint fechado', async () => {
    const { prisma } = createPrisma();
    const service = new CheckpointService(prisma);

    await expect(
      service.getOpen('event-id', CheckpointType.CHECK_IN),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('retorna 404 para evento inexistente', async () => {
    const { prisma } = createPrisma();
    (prisma.event.findUnique as jest.Mock).mockResolvedValueOnce(null);
    const service = new CheckpointService(prisma);

    await expect(
      service.getOpen('event-id', CheckpointType.CHECK_IN),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bloqueia reabertura de CHECK_IN enquanto CHECK_OUT está aberto', async () => {
    const { prisma, state } = createPrisma({
      status: EventStatus.IN_PROGRESS,
    });
    const checkOut = state.event.checkpoints[1];
    checkOut.openedAt = new Date();
    checkOut.isOpen = true;
    const service = new CheckpointService(prisma);

    await expect(
      service.open('event-id', CheckpointType.CHECK_IN),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('checkpointCannotReopenCancelledEvent: bloqueia abertura em evento cancelado', async () => {
    const { prisma } = createPrisma({
      status: EventStatus.CANCELLED,
    });
    const service = new CheckpointService(prisma);

    await expect(
      service.open('event-id', CheckpointType.CHECK_IN),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('primeira abertura exige encerramento manual e registra auditoria OPEN', async () => {
    const { prisma, state } = createPrisma();
    const service = new CheckpointService(prisma);

    const result = await service.open('event-id', CheckpointType.CHECK_IN, 42);

    expect(result.isOpen).toBe(true);
    expect(result.openedAt).not.toBeNull();
    expect(result.closesAt).toBeNull();
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: 'CHECKPOINT_OPEN_CHECK_IN',
      secretaryId: 42,
    });
  });

  it('reabre CHECK_IN mantendo primeira abertura e removendo expiração', async () => {
    const originalOpenedAt = new Date(Date.now() - 5 * 60 * 1000);
    const originalClosesAt = new Date(Date.now() + 10 * 60 * 1000);
    const { prisma, state } = createPrisma({
      status: EventStatus.IN_PROGRESS,
    });
    state.audits.push({
      action: 'CHECKPOINT_OPEN_CHECK_IN',
      eventId: 'event-id',
      createdAt: originalOpenedAt,
    });
    const checkIn = state.event.checkpoints[0];
    checkIn.isOpen = false;
    checkIn.openedAt = originalOpenedAt;
    checkIn.closedAt = new Date(Date.now() - 2 * 60 * 1000);
    checkIn.closesAt = originalClosesAt;

    const service = new CheckpointService(prisma);
    const result = await service.open('event-id', CheckpointType.CHECK_IN, 99);

    expect(result.isOpen).toBe(true);
    expect(result.closedAt).toBeNull();
    expect(result.openedAt).toBe(originalOpenedAt.toISOString());
    expect(result.closesAt).toBeNull();
    expect(state.audits).toHaveLength(2);
    expect(state.audits[1].action).toBe('CHECKPOINT_REOPEN_CHECK_IN');
    expect(state.audits[1].secretaryId).toBe(99);
  });

  it('reabre CHECK_IN após expiração da janela original', async () => {
    const expiredOpenedAt = new Date(Date.now() - 20 * 60 * 1000);
    const expiredClosesAt = new Date(Date.now() - 5 * 60 * 1000);
    const { prisma, state } = createPrisma({
      status: EventStatus.IN_PROGRESS,
    });
    state.audits.push({
      action: 'CHECKPOINT_OPEN_CHECK_IN',
      eventId: 'event-id',
      createdAt: expiredOpenedAt,
    });
    const checkIn = state.event.checkpoints[0];
    checkIn.isOpen = false;
    checkIn.openedAt = expiredOpenedAt;
    checkIn.closedAt = new Date(Date.now() - 10 * 60 * 1000);
    checkIn.closesAt = expiredClosesAt;

    const service = new CheckpointService(prisma);
    const result = await service.open('event-id', CheckpointType.CHECK_IN);
    expect(result.isOpen).toBe(true);
    expect(result.closesAt).toBeNull();
  });

  it('reabre checkpoint legado sem exigir auditoria antiga', async () => {
    const { prisma, state } = createPrisma({
      status: EventStatus.IN_PROGRESS,
    });
    const checkIn = state.event.checkpoints[0];
    checkIn.isOpen = false;
    checkIn.openedAt = new Date(Date.now() - 5 * 60 * 1000);
    checkIn.closesAt = new Date(Date.now() + 10 * 60 * 1000);

    const service = new CheckpointService(prisma);
    const result = await service.open('event-id', CheckpointType.CHECK_IN);
    expect(result.isOpen).toBe(true);
    expect(result.closesAt).toBeNull();
  });

  it('reabre sem limitar horário pela auditoria antiga', async () => {
    const { prisma, state } = createPrisma({
      status: EventStatus.IN_PROGRESS,
    });
    const now = Date.now();
    const firstOpen = new Date(now - 20 * 60 * 1000);
    const overwrittenOpen = new Date(now - 10 * 60 * 1000);

    state.audits.push({
      action: 'CHECKPOINT_OPEN_CHECK_IN',
      eventId: 'event-id',
      createdAt: firstOpen,
    });

    const checkIn = state.event.checkpoints[0];
    checkIn.isOpen = false;
    checkIn.openedAt = overwrittenOpen;
    checkIn.closesAt = new Date(now + 5 * 60 * 1000);

    const service = new CheckpointService(prisma);
    const result = await service.open('event-id', CheckpointType.CHECK_IN);
    expect(result.isOpen).toBe(true);
    expect(result.closesAt).toBeNull();
  });

  it('reabre CHECK_OUT em evento COMPLETED dentro da janela original e transiciona para IN_PROGRESS', async () => {
    const originalOpenedAt = new Date(Date.now() - 4 * 60 * 1000);
    const originalClosesAt = new Date(Date.now() + 11 * 60 * 1000);
    const { prisma, state } = createPrisma({
      status: EventStatus.COMPLETED,
    });
    state.audits.push({
      action: 'CHECKPOINT_OPEN_CHECK_OUT',
      eventId: 'event-id',
      createdAt: originalOpenedAt,
    });
    const checkIn = state.event.checkpoints[0];
    checkIn.isOpen = false;
    checkIn.openedAt = new Date(Date.now() - 30 * 60 * 1000);
    checkIn.closedAt = new Date(Date.now() - 20 * 60 * 1000);
    checkIn.closesAt = new Date(Date.now() - 15 * 60 * 1000);

    const checkOut = state.event.checkpoints[1];
    checkOut.isOpen = false;
    checkOut.openedAt = originalOpenedAt;
    checkOut.closedAt = new Date(Date.now() - 2 * 60 * 1000);
    checkOut.closesAt = originalClosesAt;

    const service = new CheckpointService(prisma);
    const result = await service.open('event-id', CheckpointType.CHECK_OUT, 12);

    expect(result.isOpen).toBe(true);
    expect(result.closedAt).toBeNull();
    expect(result.openedAt).toBe(originalOpenedAt.toISOString());
    expect(result.closesAt).toBeNull();
    expect(state.event.status).toBe(EventStatus.IN_PROGRESS);
    expect(state.audits[1].action).toBe('CHECKPOINT_REOPEN_CHECK_OUT');
  });

  it('fecha CHECK_OUT reaberto e retorna o evento para COMPLETED', async () => {
    const { prisma, state } = createPrisma({
      status: EventStatus.IN_PROGRESS,
    });
    const checkOut = state.event.checkpoints[1];
    checkOut.isOpen = true;
    checkOut.openedAt = new Date(Date.now() - 5 * 60 * 1000);
    checkOut.closesAt = new Date(Date.now() + 10 * 60 * 1000);

    const service = new CheckpointService(prisma);
    const result = await service.close(
      'event-id',
      CheckpointType.CHECK_OUT,
      12,
    );

    expect(result.isOpen).toBe(false);
    expect(state.event.status).toBe(EventStatus.COMPLETED);
    expect(state.audits[0].action).toBe('CHECKPOINT_CLOSE_CHECK_OUT');
  });

  it('reabre CHECK_OUT após expiração da janela original', async () => {
    const expiredOpenedAt = new Date(Date.now() - 25 * 60 * 1000);
    const expiredClosesAt = new Date(Date.now() - 10 * 60 * 1000);
    const { prisma, state } = createPrisma({
      status: EventStatus.COMPLETED,
    });
    const checkOut = state.event.checkpoints[1];
    checkOut.isOpen = false;
    checkOut.openedAt = expiredOpenedAt;
    checkOut.closedAt = new Date(Date.now() - 15 * 60 * 1000);
    checkOut.closesAt = expiredClosesAt;

    const service = new CheckpointService(prisma);
    const result = await service.open('event-id', CheckpointType.CHECK_OUT);
    expect(result.isOpen).toBe(true);
    expect(result.closesAt).toBeNull();
  });

  it('normaliza sob bloqueio se checkpoint estava aberto mas com prazo expirado', async () => {
    const expiredClosesAt = new Date(Date.now() - 2 * 60 * 1000);
    const { prisma, state } = createPrisma({
      status: EventStatus.IN_PROGRESS,
    });
    const checkIn = state.event.checkpoints[0];
    checkIn.isOpen = true;
    checkIn.openedAt = new Date(Date.now() - 17 * 60 * 1000);
    checkIn.closesAt = expiredClosesAt;

    const service = new CheckpointService(prisma);
    // Ao tentar abrir CHECK_OUT, o checkIn expirado é normalizado para isOpen=false e closedAt=closesAt
    const result = await service.open('event-id', CheckpointType.CHECK_OUT);
    expect(checkIn.isOpen).toBe(false);
    expect(checkIn.closedAt).toEqual(expiredClosesAt);
    expect(result.type).toBe(CheckpointType.CHECK_OUT);
    expect(result.isOpen).toBe(true);
  });
  it('recupera entradas e saídas após queda de rede mesmo com evento concluído', async () => {
    const { prisma, state } = createPrisma();
    const service = new CheckpointService(prisma);
    await service.open('event-id', CheckpointType.CHECK_IN, 42);
    await service.close('event-id', CheckpointType.CHECK_IN, 42);
    await service.open('event-id', CheckpointType.CHECK_OUT, 42);
    await expect(
      service.open('event-id', CheckpointType.CHECK_IN, 42),
    ).rejects.toThrow('Encerre o CHECK_OUT');
    await service.close('event-id', CheckpointType.CHECK_OUT, 42);
    expect(state.event.status).toBe(EventStatus.COMPLETED);
    const entry = await service.open('event-id', CheckpointType.CHECK_IN, 42);
    expect(entry.closesAt).toBeNull();
    expect(state.event.status).toBe(EventStatus.IN_PROGRESS);
    await expect(
      service.open('event-id', CheckpointType.CHECK_OUT, 42),
    ).rejects.toThrow('Encerre o CHECK_IN');
    await service.close('event-id', CheckpointType.CHECK_IN, 42);
    const exit = await service.open('event-id', CheckpointType.CHECK_OUT, 42);
    expect(exit.closesAt).toBeNull();
    await service.close('event-id', CheckpointType.CHECK_OUT, 42);
    expect(state.event.status).toBe(EventStatus.COMPLETED);
    expect(
      state.audits.some((a) => a.action === 'CHECKPOINT_REOPEN_CHECK_IN'),
    ).toBe(true);
  });
  it('mantém CHECK_IN disponível após uma hora até fechamento manual', async () => {
    jest.useFakeTimers();
    try {
      const { prisma } = createPrisma();
      const service = new CheckpointService(prisma);
      const opened = await service.open(
        'event-id',
        CheckpointType.CHECK_IN,
        42,
      );
      jest.setSystemTime(new Date(Date.now() + 60 * 60 * 1000));
      const current = await service.getOpen(
        'event-id',
        CheckpointType.CHECK_IN,
      );
      expect(current.isOpen).toBe(true);
      expect(current.closesAt).toBeNull();
      expect(current.version).toBe(opened.version);
      await service.close('event-id', CheckpointType.CHECK_IN, 42);
      await expect(
        service.getOpen('event-id', CheckpointType.CHECK_IN),
      ).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      jest.useRealTimers();
    }
  });
});
