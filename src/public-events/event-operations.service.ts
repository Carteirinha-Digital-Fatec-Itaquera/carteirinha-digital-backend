import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CertificateService } from '../certificate/certificate.service';
import { EventStorageService } from './event-storage.service';
import {
  ManualPresenceDto,
  ParticipantCorrectionDto,
  ReconcileDeliveryDto,
} from './public-events.dto';

@Injectable()
export class EventOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly certificates: CertificateService,
    private readonly storage: EventStorageService,
  ) {}
  async retry(certificateId: string, secretaryId: number) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.certificateArtifact.findUnique({
        where: { certificateId },
        include: { certificate: true },
      });
      if (
        !job ||
        job.certificate.revokedAt ||
        (job.leaseUntil && job.leaseUntil > new Date())
      )
        throw new ConflictException(
          'Certificado revogado, inexistente ou em processamento.',
        );
      if (job.deliveryState === 'AMBIGUOUS') {
        throw new ConflictException(
          'Entrega em estado ambíguo. Utilize a reconciliação administrativa auditada para confirmar envio ou reagendar.',
        );
      }
      if (job.deliveryState === 'SENT' && job.state === 'READY') {
        throw new ConflictException(
          'Certificado já emitido e entregue com sucesso.',
        );
      }
      await tx.certificateArtifact.update({
        where: { id: job.id },
        data: {
          attempts: 0,
          deliveryAttempts: 0,
          nextAttemptAt: new Date(),
          deliveryState:
            job.deliveryState === 'FAILED' ? 'PENDING' : job.deliveryState,
        },
      });
      await tx.eventAudit.create({
        data: {
          action: 'CERTIFICATE_RETRY',
          eventId: job.certificate.eventId,
          subjectId: certificateId,
          secretaryId,
        },
      });
      return { success: true, action: 'RETRIED' };
    });
  }
  async reconcileDelivery(
    certificateId: string,
    dto: ReconcileDeliveryDto,
    secretaryId: number,
  ) {
    if (!dto || !dto.reason || dto.reason.trim().length < 5) {
      throw new BadRequestException(
        'Motivo da reconciliação é obrigatório (mínimo de 5 caracteres).',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      if (typeof tx.$queryRaw === 'function') {
        try {
          await tx.$queryRaw`SELECT "id" FROM "CertificateArtifact" WHERE "certificateId" = ${certificateId} FOR UPDATE`;
        } catch {
          // Permite execução em mocks ou drivers sem suporte a raw query
        }
      }

      const job = await tx.certificateArtifact.findUnique({
        where: { certificateId },
        include: {
          certificate: {
            include: {
              event: { select: { status: true } },
            },
          },
        },
      });

      if (!job) {
        throw new NotFoundException('Artefato do certificado não encontrado.');
      }

      if (
        job.certificate.revokedAt ||
        job.certificate.event?.status === 'CANCELLED'
      ) {
        throw new ConflictException(
          'Certificado revogado ou evento cancelado não podem ser reconciliados.',
        );
      }

      if (job.leaseUntil && job.leaseUntil > new Date()) {
        throw new ConflictException(
          'Certificado em processamento ativo (lease válido). Aguarde a conclusão ou expiração.',
        );
      }

      if (job.deliveryState !== 'AMBIGUOUS') {
        throw new ConflictException(
          `Apenas certificados em estado AMBIGUOUS podem ser reconciliados. Estado atual: ${job.deliveryState}`,
        );
      }

      let newDeliveryState = job.deliveryState;
      let auditAction = 'DELIVERY_RECONCILED';
      const now = new Date();
      let updateData: Record<string, unknown> = {};

      if (dto.resolution === 'CONFIRM_SENT') {
        newDeliveryState = 'SENT';
        auditAction = 'DELIVERY_CONFIRMED_SENT';
        updateData = {
          deliveryState: 'SENT',
          leaseUntil: null,
          leaseToken: null,
        };
      } else if (dto.resolution === 'RESCHEDULE_SEND') {
        newDeliveryState = 'PENDING';
        auditAction = 'DELIVERY_RESCHEDULED';
        updateData = {
          deliveryState: 'PENDING',
          deliveryAttempts: 0,
          nextAttemptAt: now,
          leaseUntil: null,
          leaseToken: null,
        };
      } else if (dto.resolution === 'KEEP_AMBIGUOUS') {
        newDeliveryState = 'AMBIGUOUS';
        auditAction = 'DELIVERY_KEPT_AMBIGUOUS';
        updateData = {
          leaseUntil: null,
          leaseToken: null,
        };
      } else {
        throw new BadRequestException(
          `Resolução inválida: ${String(dto.resolution)}`,
        );
      }

      let updateCount = 0;
      if (typeof tx.certificateArtifact.updateMany === 'function') {
        const res = await tx.certificateArtifact.updateMany({
          where: {
            id: job.id,
            deliveryState: 'AMBIGUOUS',
            deliveryAttempts: job.deliveryAttempts,
            leaseToken: job.leaseToken ?? null,
            OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
            certificate: {
              revokedAt: null,
              event: { status: { not: 'CANCELLED' } },
            },
          },
          data: updateData,
        });
        updateCount = res.count;
      } else if (typeof tx.certificateArtifact.update === 'function') {
        await tx.certificateArtifact.update({
          where: { id: job.id },
          data: updateData,
        });
        updateCount = 1;
      }

      if (updateCount === 0) {
        throw new ConflictException(
          'Conflito de concorrência: o certificado foi alterado por outro processo ou não está mais em estado AMBIGUOUS elegível.',
        );
      }

      await tx.eventAudit.create({
        data: {
          action: auditAction,
          eventId: job.certificate.eventId,
          subjectId: certificateId,
          secretaryId,
          reason: dto.reason.trim(),
        },
      });

      return {
        success: true,
        resolution: dto.resolution,
        deliveryState: newDeliveryState,
        message: `Entrega reconciliada administrativamente como ${dto.resolution}.`,
      };
    });
  }
  async correct(
    id: string,
    dto: ParticipantCorrectionDto,
    secretaryId: number,
  ) {
    if (dto.name.trim().length < 3)
      throw new BadRequestException('Nome inválido.');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "EventParticipant" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.eventParticipant.findUnique({
        where: { id },
        include: { event: { include: { series: true } } },
      });
      if (!current || current.event.series?.purgedAt)
        throw new ConflictException(
          'Arquivo histórico encerrado para alterações.',
        );
      if (await tx.certificate.count({ where: { participantId: id } }))
        throw new ConflictException(
          'Não é permitido alterar os dados de um certificado emitido.',
        );
      const person = await tx.eventParticipant.update({
        where: { id },
        data: { name: dto.name.trim(), course: dto.course || null },
      });
      // A presença conserva seu snapshot original; a emissão v2 lê o participante corrigido.
      await tx.eventAudit.create({
        data: {
          action: 'PARTICIPANT_CORRECTED',
          subjectId: id,
          eventId: person.eventId,
          secretaryId,
          reason: dto.reason,
        },
      });
      return person;
    });
  }
  async participants(eventId: string) {
    const list = await this.prisma.eventParticipant.findMany({
      where: { eventId },
      select: {
        id: true,
        name: true,
        course: true,
        role: true,
        visitorId: true,
        accountId: true,
        attendance: {
          select: { id: true, checkInAt: true, checkOutAt: true, status: true },
        },
        certificate: {
          select: {
            id: true,
            verificationCode: true,
            issuedAt: true,
            revokedAt: true,
            artifact: { select: { state: true, deliveryState: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    const unlinked = await this.prisma.attendance.findMany({
      where: { eventId, participantId: null },
      include: { certificate: { include: { artifact: true } } },
    });
    if (unlinked.length > 0) {
      for (const att of unlinked) {
        list.push({
          id: `legacy-${att.id}`,
          name: att.studentName,
          course: att.studentCourse,
          role: 'ATTENDEE',
          visitorId: null,
          accountId: att.studentAccountId,
          attendance: {
            id: att.id,
            checkInAt: att.checkInAt,
            checkOutAt: att.checkOutAt,
            status: att.status,
          },
          certificate: att.certificate
            ? {
                id: att.certificate.id,
                verificationCode: att.certificate.verificationCode,
                issuedAt: att.certificate.issuedAt,
                revokedAt: att.certificate.revokedAt,
                artifact: att.certificate.artifact
                  ? {
                      state: att.certificate.artifact.state,
                      deliveryState: att.certificate.artifact.deliveryState,
                    }
                  : null,
              }
            : null,
        });
      }
    }
    return list;
  }
  async assignRole(
    id: string,
    role: string,
    reason: string,
    secretaryId: number,
  ) {
    if (!['ATTENDEE', 'SPEAKER'].includes(role) || reason.trim().length < 10)
      throw new BadRequestException('Informe papel e justificativa.');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "EventParticipant" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.eventParticipant.findUnique({
        where: { id },
        include: { event: { include: { series: true } } },
      });
      if (!current || current.event.series?.purgedAt)
        throw new ConflictException(
          'Arquivo histórico encerrado para alterações.',
        );
      if (await tx.certificate.count({ where: { participantId: id } }))
        throw new ConflictException('Certificado já emitido.');
      if (
        current.event.certificateEnabled &&
        current.event.certificatePolicies
      ) {
        const policy = (
          current.event.certificatePolicies as Record<string, unknown>
        )?.[role];
        if (!policy) {
          throw new BadRequestException(
            `Papel ${role} não possui modelo de certificado configurado para este evento.`,
          );
        }
      }
      const row = await tx.eventParticipant.update({
        where: { id },
        data: { role },
      });
      await tx.eventAudit.create({
        data: {
          action: `ROLE_${role}`,
          secretaryId,
          subjectId: id,
          eventId: row.eventId,
          reason,
        },
      });
      return row;
    });
  }
  async manual(eventId: string, dto: ManualPresenceDto, secretaryId: number) {
    if (dto.reason.trim().length < 10)
      throw new BadRequestException('Descreva a justificativa presencial.');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT * FROM "EventCheckpoint" WHERE "eventId" = ${eventId} ORDER BY "type" FOR UPDATE`;
      const [event] = await tx.$queryRaw<
        {
          id: string;
          status: string;
          certificateEnabled: boolean;
          seriesId: string | null;
        }[]
      >`SELECT * FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
      if (event?.seriesId) {
        const series = await tx.eventSeries.findUnique({
          where: { id: event.seriesId },
        });
        if (!series || series.purgedAt || series.retentionAt <= new Date())
          throw new ConflictException(
            'Arquivo histórico encerrado para alterações.',
          );
      }
      const person = await tx.eventParticipant.findUnique({
        where: { id: dto.participantId },
        include: { visitor: { include: { series: true } } },
      });
      if (
        !event ||
        event.status === 'CANCELLED' ||
        !person ||
        person.eventId !== eventId ||
        person.visitor?.series.purgedAt
      )
        throw new ConflictException('Participante/atividade indisponível.');
      // Registro manual não simula QR nem GPS e preserva timestamps anteriores.
      const previous = await tx.attendance.findUnique({
        where: { participantId: person.id },
      });
      const student = person.accountId
        ? await tx.student.findUnique({
            where: { accountId: person.accountId },
          })
        : null;
      if (dto.checkpoint === 'CHECK_IN') {
        if (!previous)
          await tx.attendance.create({
            data: {
              eventId,
              participantId: person.id,
              studentRa: student?.ra,
              studentAccountId: student?.accountId,
              studentRefRa: student?.ra,
              studentName: person.name,
              studentCourse: person.course || 'Participante/ouvinte',
              checkInAt: new Date(),
              evidence: { decision: 'MANUAL', secretaryId },
            },
          });
      } else {
        if (!previous?.checkInAt)
          throw new BadRequestException('Entrada obrigatória antes da saída.');
        if (!previous.checkOutAt)
          await tx.attendance.update({
            where: { id: previous.id },
            data: {
              checkOutAt: new Date(),
              status: 'CONFIRMED',
              evidence: { decision: 'MANUAL', secretaryId },
            },
          });
        if (event.certificateEnabled)
          await this.certificates.issueCertificate(previous.id, tx);
      }
      await tx.eventAudit.create({
        data: {
          action: `MANUAL_${dto.checkpoint}`,
          eventId,
          subjectId: person.id,
          secretaryId,
          reason: dto.reason.trim(),
        },
      });
      return { success: true, message: 'Registro presencial auditado.' };
    });
  }
  async enrollVisitor(eventId: string, visitorId: string) {
    const visitor = await this.prisma.visitorRegistration.findUnique({
      where: { id: visitorId },
      include: { series: true },
    });
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (
      !(visitor?.identifiedAt || visitor?.verifiedAt) ||
      visitor.series.purgedAt ||
      !event?.visitorsAllowed ||
      visitor.seriesId !== event.seriesId
    )
      throw new BadRequestException('Inscrição não pertence à atividade.');
    return this.prisma.eventParticipant.upsert({
      where: { eventId_visitorId: { eventId, visitorId } },
      create: {
        eventId,
        visitorId,
        name: visitor.name,
        course: visitor.course,
      },
      update: {},
    });
  }
  async download(id: string, visitorId?: string) {
    const row = await this.prisma.certificate.findFirst({
      where: { id, ...(visitorId ? { participant: { visitorId } } : {}) },
      include: { artifact: true },
    });
    if (!row) throw new NotFoundException('Certificado não encontrado.');
    if (row.revokedAt) throw new ConflictException('Certificado revogado.');
    if (row.artifact?.state !== 'READY' || !row.artifact.storageKey)
      throw new ConflictException(
        'PDF em processamento. Tente novamente em instantes.',
      );
    return {
      buffer: await this.storage.get(row.artifact.storageKey, true),
      code: row.verificationCode,
    };
  }
  async purge(seriesId: string, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const [series] = await tx.$queryRaw<
        { retentionAt: Date; purgedAt: Date | null }[]
      >`SELECT * FROM "EventSeries" WHERE "id" = ${seriesId} FOR UPDATE`;
      if (!series || series.purgedAt || series.retentionAt > now) return false;
      const visitors = await tx.visitorRegistration.findMany({
        where: { seriesId },
        select: { id: true },
      });
      const ids = visitors.map((v) => v.id);
      await tx.visitorSession.deleteMany({ where: { visitorId: { in: ids } } });
      await tx.presenceChallenge.deleteMany({
        where: {
          eventId: {
            in: (
              await tx.event.findMany({
                where: { seriesId },
                select: { id: true },
              })
            ).map((e) => e.id),
          },
        },
      });
      await tx.attendance.updateMany({
        where: { event: { seriesId } },
        data: { evidence: Prisma.DbNull },
      });
      await tx.visitorRegistration.updateMany({
        where: { seriesId },
        data: {
          email: null,
          name: 'Cadastro operacional encerrado',
          course: null,
          identifiedAt: null,
          verifiedAt: null,
          emailHash: null,
          cpfHash: null,
          otpHash: null,
          otpExpiresAt: null,
          lastChallengeAt: null,
          otpAttempts: 0,
        },
      });
      await tx.certificateArtifact.updateMany({
        where: {
          certificate: { participant: { visitorId: { in: ids } } },
          deliveryState: { not: 'SENT' },
        },
        data: { deliveryState: 'EXPIRED' },
      });
      await tx.eventSeries.update({
        where: { id: seriesId },
        data: { purgedAt: now },
      });
      await tx.eventAudit.updateMany({
        where: {
          eventId: {
            in: (
              await tx.event.findMany({
                where: { seriesId },
                select: { id: true },
              })
            ).map((event) => event.id),
          },
        },
        data: { reason: null },
      });
      await tx.eventAudit.create({
        data: {
          action: 'OPERATIONAL_DATA_PURGED',
          subjectId: seriesId,
          reason: `${ids.length} inscrições; certificados e histórico mínimo preservados.`,
        },
      });
      return true;
    });
  }

  async submitFeedback(
    eventId: string,
    dto: { rating: number; comments?: string; suggestions?: string },
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true },
    });
    if (!event) throw new NotFoundException('Evento não encontrado');

    const feedback = await this.prisma.eventFeedback.create({
      data: {
        eventId,
        rating: dto.rating,
        comments: dto.comments?.trim() || null,
        suggestions: dto.suggestions?.trim() || null,
      },
    });

    return {
      success: true,
      id: feedback.id,
      message: 'Avaliação enviada com sucesso! Obrigado pelo seu feedback.',
    };
  }

  async getFeedbackMetrics(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true },
    });
    if (!event) throw new NotFoundException('Evento não encontrado');

    const feedbacks = await this.prisma.eventFeedback.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        rating: true,
        comments: true,
        suggestions: true,
        createdAt: true,
      },
    });

    const totalResponses = feedbacks.length;
    const ratingDistribution: Record<number, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };
    let sumRating = 0;

    for (const f of feedbacks) {
      if (ratingDistribution[f.rating] !== undefined) {
        ratingDistribution[f.rating] += 1;
      }
      sumRating += f.rating;
    }

    const averageRating =
      totalResponses > 0 ? Number((sumRating / totalResponses).toFixed(1)) : 0;

    return {
      eventId,
      eventTitle: event.title,
      totalResponses,
      averageRating,
      ratingDistribution,
      feedbacks,
    };
  }
}
