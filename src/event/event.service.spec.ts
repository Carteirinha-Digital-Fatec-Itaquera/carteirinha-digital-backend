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
    event: {
      create: jest.fn(),
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
        orderBy: { startsAt: 'desc' },
      }),
    );

    jest.useRealTimers();
  });

  it('builds a UTC day filter for secretary listing', async () => {
    prisma.event.findMany.mockResolvedValue([]);

    await service.findAll({ date: '2026-10-05' }, 'secretary');

    expect(prisma.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              startsAt: {
                gte: new Date('2026-10-05T00:00:00.000Z'),
                lt: new Date('2026-10-06T00:00:00.000Z'),
              },
            },
          ],
        },
      }),
    );
  });

  it('rejects a semantically invalid date filter', async () => {
    await expect(
      service.findAll({ date: '2026-02-30' }, 'secretary'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('hides cancelled event details from students', async () => {
    prisma.event.findUnique.mockResolvedValue({
      id: 'event-id',
      status: 'CANCELLED',
      checkpoints: [],
    });

    await expect(service.findOne('event-id', 'student')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns 404 when event does not exist', async () => {
    prisma.event.findUnique.mockResolvedValue(null);

    await expect(
      service.findOne('missing-event', 'secretary'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks update after attendance exists', async () => {
    prisma.event.findUnique.mockResolvedValue({
      id: 'event-id',
      status: 'SCHEDULED',
      startsAt: new Date('2026-10-05T19:00:00.000Z'),
      endsAt: new Date('2026-10-05T21:00:00.000Z'),
      checkpoints: [],
      _count: { attendances: 1 },
    });

    await expect(
      service.update('event-id', { title: 'Novo título' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.event.update).not.toHaveBeenCalled();
  });

  it('blocks update while any checkpoint is open', async () => {
    prisma.event.findUnique.mockResolvedValue({
      id: 'event-id',
      status: 'SCHEDULED',
      startsAt: new Date('2026-10-05T19:00:00.000Z'),
      endsAt: new Date('2026-10-05T21:00:00.000Z'),
      checkpoints: [{ isOpen: true }],
      _count: { attendances: 0 },
    });
    await expect(
      service.update('event-id', { title: 'Novo título' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates allowed event fields before attendance', async () => {
    prisma.event.findUnique.mockResolvedValue({
      id: 'event-id',
      status: 'SCHEDULED',
      startsAt: new Date('2026-10-05T19:00:00.000Z'),
      endsAt: new Date('2026-10-05T21:00:00.000Z'),
      checkpoints: [{ isOpen: false }],
      _count: { attendances: 0 },
    });
    prisma.event.update.mockResolvedValue({ id: 'event-id' });

    await service.update('event-id', {
      title: 'Título atualizado',
      endsAt: '2026-10-05T22:00:00.000Z',
    });

    expect(prisma.event.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'event-id' },
        data: expect.objectContaining({
          title: 'Título atualizado',
          endsAt: new Date('2026-10-05T22:00:00.000Z'),
        }),
      }),
    );
  });
});
