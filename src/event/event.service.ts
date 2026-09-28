import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { UserRole } from '../auth/dto/payload.dto';
import { CreateEventDto } from './dto/create-event.dto';
import { EventQueryDto } from './dto/event-query.dto';
import { UpdateEventDto } from './dto/update-event.dto';

const eventInclude = {
  checkpoints: {
    orderBy: { type: 'asc' as const },
  },
} satisfies Prisma.EventInclude;

@Injectable()
export class EventService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEventDto, createdById: number) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.assertDateRange(startsAt, endsAt);

    return this.prisma.$transaction((tx) =>
      tx.event.create({
        data: {
          title: dto.title,
          description: dto.description,
          speaker: dto.speaker,
          location: dto.location,
          startsAt,
          endsAt,
          workloadMinutes: dto.workloadMinutes,
          certificateEnabled: dto.certificateEnabled ?? true,
          createdById,
          checkpoints: {
            create: [
              { type: 'CHECK_IN', isOpen: false, version: 1 },
              { type: 'CHECK_OUT', isOpen: false, version: 1 },
            ],
          },
        },
        include: eventInclude,
      }),
    );
  }

  async findAll(query: EventQueryDto, role: UserRole) {
    const filters: Prisma.EventWhereInput[] = [];

    if (role === 'student') {
      filters.push({
        OR: [
          { status: EventStatus.IN_PROGRESS },
          {
            status: EventStatus.SCHEDULED,
            startsAt: { gt: new Date() },
          },
        ],
      });
    }

    if (query.status) {
      filters.push({ status: query.status });
    }

    if (query.date) {
      const { start, end } = this.parseUtcDate(query.date);
      filters.push({ startsAt: { gte: start, lt: end } });
    }
    return this.prisma.event.findMany({
      where: filters.length ? { AND: filters } : undefined,
      include: eventInclude,
      orderBy: { startsAt: 'desc' },
    });
  }

  async findOne(id: string, role: UserRole) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: eventInclude,
    });

    if (!event || (role === 'student' && event.status === 'CANCELLED')) {
      throw new NotFoundException('Evento não encontrado');
    }

    return event;
  }

  async update(id: string, dto: UpdateEventDto) {
    const current = await this.prisma.event.findUnique({
      where: { id },
      include: {
        checkpoints: true,
        _count: { select: { attendances: true } },
      },
    });

    if (!current) {
      throw new NotFoundException('Evento não encontrado');
    }

    if (current._count.attendances > 0) {
      throw new ConflictException(
        'Evento com presença registrada não pode ser alterado',
      );
    }

    if (current.checkpoints.some((checkpoint) => checkpoint.isOpen)) {
      throw new ConflictException(
        'Evento com checkpoint aberto não pode ser alterado',
      );
    }

    if (current.status === 'CANCELLED') {
      throw new ConflictException('Evento cancelado não pode ser alterado');
    }

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : current.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : current.endsAt;
    this.assertDateRange(startsAt, endsAt);

    return this.prisma.event.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        speaker: dto.speaker,
        location: dto.location,
        startsAt: dto.startsAt ? startsAt : undefined,
        endsAt: dto.endsAt ? endsAt : undefined,
        workloadMinutes: dto.workloadMinutes,
        certificateEnabled: dto.certificateEnabled,
        status: dto.status,
      },
      include: eventInclude,
    });
  }

  private assertDateRange(startsAt: Date, endsAt: Date) {
    if (
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime()) ||
      endsAt <= startsAt
    ) {
      throw new BadRequestException(
        'endsAt deve ser uma data posterior a startsAt',
      );
    }
  }

  private parseUtcDate(date: string) {
    const start = new Date(`${date}T00:00:00.000Z`);
    if (
      Number.isNaN(start.getTime()) ||
      start.toISOString().slice(0, 10) !== date
    ) {
      throw new BadRequestException('Filtro date inválido');
    }

    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }
}
