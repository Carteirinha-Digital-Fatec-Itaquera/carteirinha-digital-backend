import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EventStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { UserRole } from '../auth/dto/payload.dto';
import { CreateEventDto } from './dto/create-event.dto';
import { EventQueryDto } from './dto/event-query.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { lockEventForMutation } from './event-mutation-lock';
import {
  assertGeoPolicy,
  type GeoPolicy,
} from '../public-events/presence-policy';

const eventInclude = {
  checkpoints: {
    orderBy: { type: 'asc' as const },
  },
  series: {
    select: {
      id: true,
      title: true,
      slug: true,
      isAutomatic: true,
      courses: true,
    },
  },
} satisfies Prisma.EventInclude;

@Injectable()
export class EventService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEventDto, createdById: number) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.assertDateRange(startsAt, endsAt);

    const geoPolicy =
      dto.geoPolicy !== undefined && dto.geoPolicy !== null
        ? assertGeoPolicy(dto.geoPolicy)
        : null;

    if (dto.visitorsAllowed && !geoPolicy) {
      throw new BadRequestException(
        'Atividades abertas a visitantes exigem localização configurada.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const certificatePolicies =
        await this.validateAndBuildCertificatePolicies(tx, dto);

      let seriesId = dto.seriesId || null;

      if (dto.visitorsAllowed) {
        if (seriesId) {
          const series = await tx.eventSeries.findUnique({
            where: { id: seriesId },
          });
          if (!series || series.purgedAt) {
            throw new BadRequestException('Edição inválida ou arquivada.');
          }
          if (startsAt < series.startsAt || endsAt > series.endsAt) {
            throw new BadRequestException(
              'A atividade deve estar dentro do período da edição.',
            );
          }
          if (
            dto.organizerCourse &&
            !series.courses.includes(dto.organizerCourse)
          ) {
            throw new BadRequestException('Curso não pertence à edição.');
          }
        } else {
          const autoSeries = await tx.eventSeries.create({
            data: {
              isAutomatic: true,
              published: true,
              slug: 'auto-' + randomUUID().toLowerCase(),
              title: dto.title,
              startsAt,
              endsAt,
              retentionAt: new Date(endsAt.getTime() + 30 * 86400000),
              courses: dto.organizerCourse ? [dto.organizerCourse] : ['Geral'],
              cpfRequired: true,
            },
          });
          seriesId = autoSeries.id;
        }
      }

      const event = await tx.event.create({
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
          visitorsAllowed: dto.visitorsAllowed ?? false,
          organizerCourse: dto.organizerCourse ?? null,
          promoter: dto.promoter ?? null,
          windowMinutes: dto.visitorsAllowed ? 15 : null,
          geoPolicy: geoPolicy
            ? (geoPolicy as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
          certificatePolicies: certificatePolicies
            ? (certificatePolicies as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
          seriesId,
          checkpoints: {
            create: [
              { type: 'CHECK_IN', isOpen: false, version: 1 },
              { type: 'CHECK_OUT', isOpen: false, version: 1 },
            ],
          },
        },
        include: eventInclude,
      });

      await tx.eventAudit.create({
        data: {
          eventId: event.id,
          action: 'EVENT_CREATED',
          secretaryId: createdById,
        },
      });

      return event;
    });
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
      await tx.eventAudit.create({
        data: {
          eventId: id,
          subjectId: id,
          action: `EVENT_CANCELLED_FROM_${event.status}`,
          secretaryId,
          reason: trimmedReason,
          createdAt: now,
        },
      });
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

  async restore(id: string, reason: string, secretaryId: number) {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (trimmed.length < 3 || trimmed.length > 1000)
      throw new BadRequestException(
        'Informe uma justificativa de 3 a 1000 caracteres.',
      );
    return this.prisma.$transaction(async (tx) => {
      const { event, checkpoints } = await lockEventForMutation(tx, id);
      if (event.status !== EventStatus.CANCELLED)
        throw new ConflictException(
          'O evento já não está cancelado. Atualize a lista.',
        );
      if (event.seriesId) {
        const series = await tx.eventSeries.findUnique({
          where: { id: event.seriesId },
          select: { purgedAt: true },
        });
        if (!series || series.purgedAt)
          throw new ConflictException(
            'Histórico expurgado não permite restaurar este evento.',
          );
      }
      const now = new Date();
      const before = event.cancelledAt
        ? await tx.eventAudit.findFirst({
            where: {
              eventId: id,
              createdAt: event.cancelledAt,
              action: {
                in: [
                  'EVENT_CANCELLED_FROM_SCHEDULED',
                  'EVENT_CANCELLED_FROM_IN_PROGRESS',
                  'EVENT_CANCELLED_FROM_COMPLETED',
                ],
              },
            },
            orderBy: { id: 'asc' },
          })
        : null;
      const recordedStatus = before?.action.replace(
        'EVENT_CANCELLED_FROM_',
        '',
      ) as EventStatus | undefined;
      const nextStatus =
        recordedStatus ??
        (event.endsAt <= now ||
        checkpoints.some(
          (cp) =>
            cp.type === 'CHECK_OUT' &&
            cp.closedAt &&
            (!event.cancelledAt || cp.closedAt < event.cancelledAt),
        )
          ? EventStatus.COMPLETED
          : event.startsAt <= now || checkpoints.some((cp) => cp.openedAt)
            ? EventStatus.IN_PROGRESS
            : EventStatus.SCHEDULED);
      await tx.eventAudit.create({
        data: {
          eventId: id,
          subjectId: id,
          action: 'EVENT_CANCELLATION_CAPTURED',
          secretaryId: event.cancelledById,
          reason: event.cancelReason,
          createdAt: event.cancelledAt ?? now,
        },
      });
      // Repair inconsistent legacy cancellations without reviving any document.
      await tx.certificate.updateMany({
        where: { eventId: id, revokedAt: null },
        data: { revokedAt: now, revocationReason: 'EVENT_CANCELLED' },
      });
      for (const cp of checkpoints)
        await tx.eventCheckpoint.update({
          where: { id: cp.id },
          data: {
            isOpen: false,
            closesAt: null,
            closedAt: cp.isOpen ? now : cp.closedAt,
            version: { increment: 1 },
          },
        });
      const restored = await tx.event.update({
        where: { id },
        data: {
          status: nextStatus,
          cancelReason: null,
          cancelledAt: null,
          cancelledById: null,
        },
        include: eventInclude,
      });
      await tx.eventAudit.create({
        data: {
          eventId: id,
          subjectId: id,
          action: 'EVENT_CANCELLATION_REVOKED',
          secretaryId,
          reason: `${trimmed} [status: ${nextStatus}]`,
        },
      });
      return restored;
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

      if (
        dto.seriesId &&
        event.seriesId &&
        dto.seriesId !== event.seriesId &&
        (await tx.eventParticipant.count({ where: { eventId: id } }))
      ) {
        throw new ConflictException(
          'Não é permitido transferir uma atividade com inscritos para outra edição.',
        );
      }

      const startsAt = dto.startsAt ? new Date(dto.startsAt) : event.startsAt;
      const endsAt = dto.endsAt ? new Date(dto.endsAt) : event.endsAt;
      this.assertDateRange(startsAt, endsAt);

      const visitorsAllowed =
        dto.visitorsAllowed !== undefined
          ? dto.visitorsAllowed
          : event.visitorsAllowed;

      let geoPolicy: GeoPolicy | null | undefined;
      if (dto.geoPolicy !== undefined) {
        geoPolicy = dto.geoPolicy ? assertGeoPolicy(dto.geoPolicy) : null;
      } else {
        geoPolicy = event.geoPolicy as GeoPolicy | null;
      }

      if (visitorsAllowed && !geoPolicy) {
        throw new BadRequestException(
          'Atividades abertas a visitantes exigem localização configurada.',
        );
      }

      const certificatePolicies =
        await this.validateAndBuildCertificatePolicies(tx, dto);

      let seriesId = dto.seriesId !== undefined ? dto.seriesId : event.seriesId;

      if (visitorsAllowed && !seriesId) {
        const autoSeries = await tx.eventSeries.create({
          data: {
            isAutomatic: true,
            published: true,
            slug: 'auto-' + randomUUID().toLowerCase(),
            title: dto.title ?? event.title,
            startsAt,
            endsAt,
            retentionAt: new Date(endsAt.getTime() + 30 * 86400000),
            courses:
              (dto.organizerCourse ?? event.organizerCourse)
                ? [dto.organizerCourse ?? event.organizerCourse!]
                : ['Geral'],
            cpfRequired: true,
          },
        });
        seriesId = autoSeries.id;
      } else if (seriesId) {
        const series = await tx.eventSeries.findUnique({
          where: { id: seriesId },
        });
        if (!series || series.purgedAt) {
          throw new BadRequestException('Edição inválida ou arquivada.');
        }
        if (series.isAutomatic) {
          const courses = (
            dto.organizerCourse !== undefined
              ? dto.organizerCourse
              : event.organizerCourse
          )
            ? [
                (dto.organizerCourse !== undefined
                  ? dto.organizerCourse
                  : event.organizerCourse)!,
              ]
            : series.courses;
          await tx.eventSeries.update({
            where: { id: series.id },
            data: {
              title: dto.title ?? series.title,
              startsAt,
              endsAt,
              retentionAt: new Date(endsAt.getTime() + 30 * 86400000),
              courses,
            },
          });
        } else {
          if (startsAt < series.startsAt || endsAt > series.endsAt) {
            throw new BadRequestException(
              'Os horários devem estar dentro do período da edição.',
            );
          }
          if (
            dto.organizerCourse &&
            !series.courses.includes(dto.organizerCourse)
          ) {
            throw new BadRequestException('Edição/curso inválido.');
          }
        }
      }

      const updated = await tx.event.update({
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
          visitorsAllowed: dto.visitorsAllowed,
          organizerCourse: dto.organizerCourse,
          promoter: dto.promoter,
          windowMinutes: visitorsAllowed ? 15 : undefined,
          geoPolicy:
            dto.geoPolicy !== undefined
              ? geoPolicy
                ? (geoPolicy as unknown as Prisma.InputJsonValue)
                : Prisma.DbNull
              : undefined,
          certificatePolicies:
            certificatePolicies !== undefined
              ? certificatePolicies
                ? (certificatePolicies as unknown as Prisma.InputJsonValue)
                : Prisma.DbNull
              : undefined,
          seriesId: seriesId !== undefined ? seriesId : undefined,
        },
        include: eventInclude,
      });

      await tx.eventAudit.create({
        data: {
          eventId: id,
          action: 'EVENT_UPDATED',
          secretaryId,
        },
      });

      return updated;
    });
  }

  async delete(id: string, secretaryId: number) {
    return this.prisma.$transaction(async (tx) => {
      const { checkpoints, event } = await lockEventForMutation(tx, id);
      if (await tx.attendance.count({ where: { eventId: id } }))
        throw new ConflictException(
          'Evento com histórico deve ser cancelado, não excluído.',
        );
      if (await tx.eventParticipant.count({ where: { eventId: id } }))
        throw new ConflictException(
          'Evento com inscrições deve ser cancelado, não excluído.',
        );

      if (checkpoints.some((checkpoint) => checkpoint.isOpen)) {
        throw new ConflictException(
          'Evento com checkpoint aberto não pode ser excluído',
        );
      }

      await tx.attendanceQrReference.deleteMany({
        where: {
          checkpoint: { eventId: id },
        },
      });

      await tx.certificate.deleteMany({
        where: { eventId: id },
      });

      await tx.attendance.deleteMany({
        where: { eventId: id },
      });

      await tx.eventCheckpoint.deleteMany({
        where: { eventId: id },
      });

      await tx.event.delete({
        where: { id },
      });

      if (event.seriesId) {
        const series = await tx.eventSeries.findUnique({
          where: { id: event.seriesId },
          include: { events: true },
        });
        if (series?.isAutomatic && series.events.length <= 1) {
          await tx.visitorSession.deleteMany({
            where: { visitor: { seriesId: series.id } },
          });
          await tx.visitorRegistration.deleteMany({
            where: { seriesId: series.id },
          });
          await tx.eventSeries.delete({
            where: { id: series.id },
          });
        }
      }

      await tx.eventAudit.create({
        data: {
          eventId: id,
          action: 'EVENT_DELETED_WITHOUT_HISTORY',
          secretaryId,
        },
      });

      return {
        message: 'Evento excluído com sucesso',
        id,
      };
    });
  }

  private async validateAndBuildCertificatePolicies(
    tx: Prisma.TransactionClient,
    dto: {
      attendeeTemplateId?: string;
      speakerTemplateId?: string;
      signerIds?: string[];
      speakerSignerIds?: string[];
      certificatePolicies?: unknown;
    },
  ): Promise<Record<string, unknown> | null | undefined> {
    const rawPolicies = dto.certificatePolicies as
      | Record<string, { templateId?: string; signerIds?: string[] }>
      | null
      | undefined;

    if (rawPolicies === null) {
      return null;
    }

    const attendeeTemplateId =
      dto.attendeeTemplateId ?? rawPolicies?.ATTENDEE?.templateId;
    const signerIds = dto.signerIds ?? rawPolicies?.ATTENDEE?.signerIds;
    const speakerTemplateId =
      dto.speakerTemplateId ?? rawPolicies?.SPEAKER?.templateId;
    const speakerSignerIds =
      dto.speakerSignerIds ?? rawPolicies?.SPEAKER?.signerIds;

    const hasNewConfig =
      attendeeTemplateId !== undefined ||
      signerIds !== undefined ||
      speakerTemplateId !== undefined ||
      speakerSignerIds !== undefined;

    if (!hasNewConfig && rawPolicies === undefined) {
      return undefined;
    }

    if (!attendeeTemplateId && !signerIds && !speakerTemplateId) {
      return null;
    }

    if (!attendeeTemplateId || !signerIds) {
      throw new BadRequestException(
        'Configuração de certificado para participantes requer modelo e assinantes.',
      );
    }

    if (
      !Array.isArray(signerIds) ||
      signerIds.length < 1 ||
      signerIds.length > 3 ||
      new Set(signerIds).size !== signerIds.length
    ) {
      throw new BadRequestException(
        'Escolha de um a três assinantes distintos.',
      );
    }

    const attendeeTemplate = await tx.certificateTemplate.findFirst({
      where: { id: attendeeTemplateId, role: 'ATTENDEE', status: 'PUBLISHED' },
    });
    if (!attendeeTemplate) {
      throw new BadRequestException(
        'Selecione modelos publicados para cada papel.',
      );
    }

    const allSignerIds = [
      ...new Set([...signerIds, ...(speakerSignerIds || [])]),
    ];
    const signersCount = await tx.certificateSigner.count({
      where: { id: { in: allSignerIds }, archived: false },
    });
    if (signersCount !== allSignerIds.length) {
      throw new BadRequestException('Assinante arquivado ou inexistente.');
    }

    const policies: Record<
      string,
      { templateId: string; signerIds: string[] }
    > = {
      ATTENDEE: {
        templateId: attendeeTemplateId,
        signerIds,
      },
    };

    if (speakerTemplateId) {
      const spkSigners = speakerSignerIds || signerIds;
      if (
        !Array.isArray(spkSigners) ||
        spkSigners.length < 1 ||
        spkSigners.length > 3 ||
        new Set(spkSigners).size !== spkSigners.length
      ) {
        throw new BadRequestException(
          'Escolha de um a três assinantes distintos para palestrantes.',
        );
      }
      const speakerTemplate = await tx.certificateTemplate.findFirst({
        where: { id: speakerTemplateId, role: 'SPEAKER', status: 'PUBLISHED' },
      });
      if (!speakerTemplate) {
        throw new BadRequestException(
          'Selecione modelos publicados para cada papel.',
        );
      }
      policies.SPEAKER = {
        templateId: speakerTemplateId,
        signerIds: spkSigners,
      };
    }

    return policies;
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
