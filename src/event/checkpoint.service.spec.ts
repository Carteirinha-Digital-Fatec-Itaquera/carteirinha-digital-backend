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
}

interface MockEvent {
  id: string;
  status: EventStatus;
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
  const state = {
    event,
    updatedEventStatus: undefined as EventStatus | undefined,
    updateManyCount: 1,
  };

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    event: {
      findUnique: jest.fn().mockImplementation(() => state.event),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: { status: EventStatus } }) => {
          state.updatedEventStatus = data.status;
          state.event.status = data.status;
          return state.event;
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

  it('bloqueia reabertura de CHECK_IN após início do CHECK_OUT', async () => {
    const { prisma, state } = createPrisma({
      status: EventStatus.IN_PROGRESS,
    });
    const checkOut = state.event.checkpoints[1];
    checkOut.openedAt = new Date();
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
});
