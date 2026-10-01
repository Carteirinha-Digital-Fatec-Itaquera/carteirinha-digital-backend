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
import { lockEventForMutation } from './event-mutation-lock';

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

  async cancel(id: string, reason: string, secretaryId: number) {
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (trimmedReason.length < 3 || trimmedReason.length > 1000) {
      throw new BadRequestException(
        'Motivo do cancelamento deve ter entre 3 e 1000 caracteres',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const { event, checkpoints } = await lockEventForMutation(tx, id);

      if (event.status === EventStatus.CANCELLED) {
        // Repetição preserva primeiro motivo, data e autor
        // Mas saneia eventuais certificados válidos que ainda estejam sem revogação
        await tx.certificate.updateMany({
          where: {
            eventId: id,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
          },
        });

        const refreshed = await tx.event.findUnique({
          where: { id },
          include: eventInclude,
        });
        return refreshed!;
      }

      const now = new Date();

      // Fecha checkpoints abertos e incrementa versões
      const openCheckpoints = checkpoints.filter((cp) => cp.isOpen);
      for (const cp of openCheckpoints) {
        await tx.eventCheckpoint.updateMany({
          where: {
            id: cp.id,
            isOpen: true,
          },
          data: {
            isOpen: false,
            closedAt: now,
            version: { increment: 1 },
          },
        });
      }

      // Marca evento como cancelado e registra auditoria
      await tx.event.update({
        where: { id },
        data: {
          status: EventStatus.CANCELLED,
          cancelReason: trimmedReason,
          cancelledAt: now,
          cancelledById: secretaryId,
        },
      });

      // Revoga todos os certificados ativos do evento
      await tx.certificate.updateMany({
        where: {
          eventId: id,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      const updated = await tx.event.findUnique({
        where: { id },
        include: eventInclude,
      });
      return updated!;
    });
  }

  async update(id: string, dto: UpdateEventDto, secretaryId: number) {
    if (dto.status === 'CANCELLED') {
      const otherFields = { ...dto };
      delete otherFields.status;
      delete otherFields.cancelReason;
      const hasOtherEdits = Object.values(otherFields).some(
        (v) => v !== undefined,
      );
      if (hasOtherEdits) {
        throw new BadRequestException(
          'Não é permitido misturar cancelamento com atualização de campos do evento',
        );
      }
      if (
        !dto.cancelReason ||
        typeof dto.cancelReason !== 'string' ||
        dto.cancelReason.trim().length === 0
      ) {
        throw new BadRequestException(
          'Motivo do cancelamento é obrigatório ao cancelar o evento',
        );
      }
      return this.cancel(id, dto.cancelReason, secretaryId);
    }

    if (dto.cancelReason && dto.status !== 'CANCELLED') {
      throw new BadRequestException(
        'cancelReason só pode ser fornecido quando status for CANCELLED',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const { event, checkpoints } = await lockEventForMutation(tx, id);

      if (event.status === EventStatus.CANCELLED) {
        throw new ConflictException('Evento cancelado não pode ser alterado');
      }

      if (checkpoints.some((checkpoint) => checkpoint.isOpen)) {
        throw new ConflictException(
          'Evento com checkpoint aberto não pode ser alterado',
        );
      }

      const attendanceCount = await tx.attendance.count({
        where: { eventId: id },
      });

      if (attendanceCount > 0) {
        throw new ConflictException(
          'Evento com presença registrada não pode ser alterado',
        );
      }

      const startsAt = dto.startsAt ? new Date(dto.startsAt) : event.startsAt;
      const endsAt = dto.endsAt ? new Date(dto.endsAt) : event.endsAt;
      this.assertDateRange(startsAt, endsAt);

      return tx.event.update({
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
        },
        include: eventInclude,
      });
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
