/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EventService } from './event.service';

describe('EventService', () => {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    event: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    attendanceQrReference: {
      deleteMany: jest.fn(),
    },
    eventCheckpoint: {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    certificate: {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    attendance: {
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
    event: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  let service: EventService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EventService(prisma as unknown as PrismaService);
  });

  it('creates an event and both closed checkpoints atomically', async () => {
    tx.event.create.mockResolvedValue({ id: 'event-id' });

    await service.create(
      {
        title: 'Evento teste',
        speaker: 'Palestrante',
        location: 'Auditório',
        startsAt: '2026-10-05T19:00:00.000Z',
        endsAt: '2026-10-05T21:00:00.000Z',
        workloadMinutes: 120,
      },
      7,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdById: 7,
          certificateEnabled: true,
          checkpoints: {
            create: [
              { type: 'CHECK_IN', isOpen: false, version: 1 },
              { type: 'CHECK_OUT', isOpen: false, version: 1 },
            ],
          },
        }),
      }),
    );
  });

  it('rejects an end time that is not after the start time', async () => {
    await expect(
      service.create(
        {
          title: 'Evento teste',
          speaker: 'Palestrante',
          location: 'Auditório',
          startsAt: '2026-10-05T21:00:00.000Z',
          endsAt: '2026-10-05T19:00:00.000Z',
          workloadMinutes: 120,
        },
        7,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('limits student listing without letting filters broaden visibility', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-28T12:00:00.000Z'));
    prisma.event.findMany.mockResolvedValue([]);

    await service.findAll({ status: 'SCHEDULED' }, 'student');
    expect(prisma.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { status: 'IN_PROGRESS' },
                {
                  status: 'SCHEDULED',
                  startsAt: { gt: new Date('2026-09-28T12:00:00.000Z') },
                },
              ],
            },
            { status: 'SCHEDULED' },
          ],
        },
      }),
    );
    jest.useRealTimers();
  });

  it('returns all events for secretary', async () => {
    prisma.event.findMany.mockResolvedValue([]);

    await service.findAll({}, 'secretary');
    expect(prisma.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: undefined,
        orderBy: { startsAt: 'desc' },
      }),
    );
  });

  it('hides cancelled event from student on findOne', async () => {
    prisma.event.findUnique.mockResolvedValue({
      id: 'event-id',
      status: 'CANCELLED',
    });

    await expect(service.findOne('event-id', 'student')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns cancelled event for secretary', async () => {
    const cancelledEvent = { id: 'event-id', status: 'CANCELLED' };
    prisma.event.findUnique.mockResolvedValue(cancelledEvent);

    await expect(service.findOne('event-id', 'secretary')).resolves.toEqual(
      cancelledEvent,
    );
  });

  it('throws NotFoundException when event is missing', async () => {
    prisma.event.findUnique.mockResolvedValue(null);

    await expect(
      service.findOne('missing-event', 'secretary'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cancelRevokesAndClosesAtomically: closes open checkpoints, sets cancel metadata and revokes valid certificates', async () => {
    const fixedNow = new Date('2026-10-01T15:00:00.000Z');
    jest.useFakeTimers().setSystemTime(fixedNow);

    const mockEvent = {
      id: 'event-1',
      status: 'IN_PROGRESS',
      checkpoints: [
        { id: 'cp-in', type: 'CHECK_IN', isOpen: true, version: 2 },
        { id: 'cp-out', type: 'CHECK_OUT', isOpen: false, version: 1 },
      ],
    };
    tx.event.findUnique.mockResolvedValueOnce(mockEvent).mockResolvedValueOnce({
      ...mockEvent,
      status: 'CANCELLED',
      cancelReason: 'Auditório em obras',
      cancelledAt: fixedNow,
      cancelledById: 10,
    });

    const result = await service.cancel(
      'event-1',
      '  Auditório em obras  ',
      10,
    );

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.eventCheckpoint.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'cp-in',
        isOpen: true,
      },
      data: {
        isOpen: false,
        closedAt: fixedNow,
        version: { increment: 1 },
      },
    });
    expect(tx.event.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'event-1' },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelReason: 'Auditório em obras',
          cancelledAt: fixedNow,
          cancelledById: 10,
        }),
      }),
    );
    expect(tx.certificate.updateMany).toHaveBeenCalledWith({
      where: {
        eventId: 'event-1',
        revokedAt: null,
      },
      data: {
        revokedAt: fixedNow,
      },
    });
    expect(result.status).toBe('CANCELLED');

    jest.useRealTimers();
  });

  it('cancellationRollbackPreservesOriginalState: fails transaction if certificate revocation throws', async () => {
    tx.event.findUnique.mockResolvedValue({
      id: 'event-1',
      status: 'IN_PROGRESS',
      checkpoints: [],
    });
    tx.certificate.updateMany.mockRejectedValueOnce(new Error('DB failure'));

    await expect(
      service.cancel('event-1', 'Motivo válido', 10),
    ).rejects.toThrow('DB failure');
  });

  it('repeatPreservesFirstMetadata: repeated cancel preserves first reason, date and actor', async () => {
    const originalDate = new Date('2026-09-25T10:00:00.000Z');
    const existingCancelled = {
      id: 'event-1',
      status: 'CANCELLED',
      cancelReason: 'Primeiro motivo gravado',
      cancelledAt: originalDate,
      cancelledById: 5,
      checkpoints: [{ id: 'cp-1', isOpen: false, version: 3 }],
    };
    tx.event.findUnique.mockResolvedValue(existingCancelled);

    const result = await service.cancel(
      'event-1',
      'Novo motivo que deve ser ignorado',
      99,
    );

    expect(tx.event.update).not.toHaveBeenCalled();
    expect(result.cancelReason).toBe('Primeiro motivo gravado');
    expect(result.cancelledAt).toEqual(originalDate);
    expect(result.cancelledById).toBe(5);
    // Mas garante saneamento de certificados caso algum tenha ficado sem revogação
    expect(tx.certificate.updateMany).toHaveBeenCalledWith({
      where: {
        eventId: 'event-1',
        revokedAt: null,
      },
      data: expect.objectContaining({
        revokedAt: expect.any(Date),
      }),
    });
  });

  it('legacyPatchUsesSameCancellation: PATCH with status CANCELLED delegates to cancel flow', async () => {
    const fixedNow = new Date('2026-10-01T15:00:00.000Z');
    jest.useFakeTimers().setSystemTime(fixedNow);

    const mockEvent = {
      id: 'event-1',
      status: 'SCHEDULED',
      checkpoints: [],
    };
    tx.event.findUnique.mockResolvedValueOnce(mockEvent).mockResolvedValueOnce({
      ...mockEvent,
      status: 'CANCELLED',
      cancelReason: 'Motivo legado',
      cancelledAt: fixedNow,
      cancelledById: 7,
    });

    await service.update(
      'event-1',
      { status: 'CANCELLED', cancelReason: '  Motivo legado  ' },
      7,
    );

    expect(tx.event.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'event-1' },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelReason: 'Motivo legado',
          cancelledById: 7,
        }),
      }),
    );

    jest.useRealTimers();
  });

  it('mixedCancellationAndEditsRejected: rejects PATCH mixing cancellation with edits or missing reason', async () => {
    await expect(
      service.update(
        'event-1',
        { status: 'CANCELLED', cancelReason: 'Motivo', title: 'Novo Título' },
        7,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.update('event-1', { status: 'CANCELLED' }, 7),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.update('event-1', { cancelReason: 'Apenas motivo' }, 7),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('editingRechecksAttendanceAfterLock: blocks update after lock if attendance exists', async () => {
    tx.event.findUnique.mockResolvedValue({
      id: 'event-id',
      status: 'SCHEDULED',
      startsAt: new Date('2026-10-05T19:00:00.000Z'),
      endsAt: new Date('2026-10-05T21:00:00.000Z'),
      checkpoints: [],
    });
    tx.attendance.count.mockResolvedValue(1);

    await expect(
      service.update('event-id', { title: 'Novo título' }, 7),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.event.update).not.toHaveBeenCalled();
  });

  it('blocks update while any checkpoint is open', async () => {
    tx.event.findUnique.mockResolvedValue({
      id: 'event-id',
      status: 'SCHEDULED',
      startsAt: new Date('2026-10-05T19:00:00.000Z'),
      endsAt: new Date('2026-10-05T21:00:00.000Z'),
      checkpoints: [{ isOpen: true }],
    });
    tx.attendance.count.mockResolvedValue(0);

    await expect(
      service.update('event-id', { title: 'Novo título' }, 7),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks update if event is cancelled', async () => {
    tx.event.findUnique.mockResolvedValue({
      id: 'event-id',
      status: 'CANCELLED',
      startsAt: new Date('2026-10-05T19:00:00.000Z'),
      endsAt: new Date('2026-10-05T21:00:00.000Z'),
      checkpoints: [{ isOpen: false }],
    });
    tx.attendance.count.mockResolvedValue(0);

    await expect(
      service.update('event-id', { title: 'Novo título' }, 7),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates allowed event fields before attendance', async () => {
    tx.event.findUnique.mockResolvedValue({
      id: 'event-id',
      status: 'SCHEDULED',
      startsAt: new Date('2026-10-05T19:00:00.000Z'),
      endsAt: new Date('2026-10-05T21:00:00.000Z'),
      checkpoints: [{ isOpen: false }],
    });
    tx.attendance.count.mockResolvedValue(0);
    tx.event.update.mockResolvedValue({ id: 'event-id' });

    await service.update(
      'event-id',
      {
        title: 'Título atualizado',
        endsAt: '2026-10-05T22:00:00.000Z',
      },
      7,
    );

    expect(tx.event.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'event-id' },
        data: expect.objectContaining({
          title: 'Título atualizado',
          endsAt: new Date('2026-10-05T22:00:00.000Z'),
        }),
      }),
    );
  });

  it('deletes an event and all related dependencies atomically', async () => {
    tx.event.findUnique.mockResolvedValue({
      id: 'event-id',
      status: 'SCHEDULED',
      checkpoints: [{ id: 'cp-1', isOpen: false }],
    });
    tx.event.delete.mockResolvedValue({ id: 'event-id' });

    const result = await service.delete('event-id', 7);

    expect(result).toEqual({
      message: 'Evento excluído com sucesso',
      id: 'event-id',
    });
    expect(tx.attendanceQrReference.deleteMany).toHaveBeenCalledWith({
      where: { checkpoint: { eventId: 'event-id' } },
    });
    expect(tx.certificate.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'event-id' },
    });
    expect(tx.attendance.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'event-id' },
    });
    expect(tx.eventCheckpoint.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'event-id' },
    });
    expect(tx.event.delete).toHaveBeenCalledWith({
      where: { id: 'event-id' },
    });
  });

  it('blocks deletion if event has an open checkpoint', async () => {
    tx.event.findUnique.mockResolvedValue({
      id: 'event-id',
      status: 'IN_PROGRESS',
      checkpoints: [{ id: 'cp-1', isOpen: true }],
    });

    await expect(service.delete('event-id', 7)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.event.delete).not.toHaveBeenCalled();
  });
});
