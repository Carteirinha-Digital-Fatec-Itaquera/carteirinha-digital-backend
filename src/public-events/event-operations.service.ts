import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  parseParticipantFile,
  normalizeParticipantName,
  assertParticipantFileEvent,
} from './participant-file';
import { isEmail } from 'class-validator';
import { lockEventForMutation } from '../event/event-mutation-lock';
import { validCpf, visitorIdentityHash } from './visitor.service';
import { PrismaService } from '../database/prisma.service';
import { CertificateService } from '../certificate/certificate.service';
import { EventStorageService } from './event-storage.service';
import {
  ManualPresenceDto,
  BulkManualCheckoutDto,
  ManualCertificateDto,
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
          'Entrega em estado ambÃ­guo. Utilize a reconciliaÃ§Ã£o administrativa auditada para confirmar envio ou reagendar.',
        );
      }
      if (job.deliveryState === 'SENT' && job.state === 'READY') {
        throw new ConflictException(
          'Certificado jÃ¡ emitido e entregue com sucesso.',
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
        'Motivo da reconciliaÃ§Ã£o Ã© obrigatÃ³rio (mÃ­nimo de 5 caracteres).',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      // Serialize with event cancellation before locking its artifact.
      await tx.$queryRaw`SELECT e."id" FROM "Event" e JOIN "Certificate" c ON c."eventId" = e."id" WHERE c."id" = ${certificateId} FOR UPDATE OF e`;
      await tx.$queryRaw`SELECT "id" FROM "CertificateArtifact" WHERE "certificateId" = ${certificateId} FOR UPDATE`;

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
        throw new NotFoundException('Artefato do certificado nÃ£o encontrado.');
      }

      if (
        job.certificate.revokedAt ||
        job.certificate.event?.status === 'CANCELLED'
      ) {
        throw new ConflictException(
          'Certificado revogado ou evento cancelado nÃ£o podem ser reconciliados.',
        );
      }

      if (job.leaseUntil && job.leaseUntil > new Date()) {
        throw new ConflictException(
          'Certificado em processamento ativo (lease vÃ¡lido). Aguarde a conclusÃ£o ou expiraÃ§Ã£o.',
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
          `ResoluÃ§Ã£o invÃ¡lida: ${String(dto.resolution)}`,
        );
      }

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
      const updateCount = res.count;

      if (updateCount === 0) {
        throw new ConflictException(
          'Conflito de concorrÃªncia: o certificado foi alterado por outro processo ou nÃ£o estÃ¡ mais em estado AMBIGUOUS elegÃ­vel.',
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
      throw new BadRequestException('Nome invÃ¡lido.');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "EventParticipant" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.eventParticipant.findUnique({
        where: { id },
        include: { event: { include: { series: true } } },
      });
      if (!current || current.event.series?.purgedAt)
        throw new ConflictException(
          'Arquivo histÃ³rico encerrado para alteraÃ§Ãµes.',
        );
      if (await tx.certificate.count({ where: { participantId: id } }))
        throw new ConflictException(
          'NÃ£o Ã© permitido alterar os dados de um certificado emitido.',
        );
      const person = await tx.eventParticipant.update({
        where: { id },
        data: { name: dto.name.trim(), course: dto.course || null },
      });
      // A presenÃ§a conserva seu snapshot original; a emissÃ£o v2 lÃª o participante corrigido.
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
  async searchStudents(query: string) {
    const normalize = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
    if (
      typeof query !== 'string' ||
      query.trim().length < 3 ||
      query.length > 160
    )
      throw new BadRequestException('Informe entre 3 e 160 caracteres.');
    const rows = await this.prisma.student.findMany({
      select: {
        ra: true,
        accountId: true,
        name: true,
        socialName: true,
        course: true,
        status: true,
        email: true,
      },
      orderBy: [{ name: 'asc' }, { ra: 'asc' }],
    });
    const tokens = normalize(query).split(' ');
    const matches = rows.filter(
      (row) =>
        tokens.every(
          (token) =>
            normalize(row.name).includes(token) ||
            normalize(row.socialName || '').includes(token),
        ) || row.ra === query.trim(),
    );
    return {
      total: matches.length,
      items: matches.slice(0, 20).map((row) => ({
        ...row,
        name: row.socialName || row.name,
        email: row.email.replace(/^(.).*(@.*)$/, '$1***$2'),
      })),
    };
  }
  async analyzeParticipantFile(eventId: string, file: Express.Multer.File) {
    const rows = parseParticipantFile(file);
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        startsAt: true,
        status: true,
        certificateEnabled: true,
      },
    });
    if (!event) throw new NotFoundException('Evento não encontrado.');
    assertParticipantFileEvent(file, event);
    if (
      event.status === 'CANCELLED' ||
      event.status === 'SCHEDULED' ||
      !event.certificateEnabled
    )
      throw new ConflictException(
        'Evento indisponível para emissão administrativa.',
      );
    const students = await this.prisma.student.findMany({
      select: {
        ra: true,
        accountId: true,
        name: true,
        socialName: true,
        status: true,
        email: true,
      },
    });
    const seen = new Set<string>();
    return {
      event,
      items: rows.map((row, index) => {
        const matches = students.filter(
          (student) =>
            normalizeParticipantName(student.name) ===
            normalizeParticipantName(row.name),
        );
        const student = matches.length === 1 ? matches[0] : null;
        let status = row.review
          ? 'REVIEW'
          : matches.length > 1
            ? 'AMBIGUOUS'
            : !student
              ? 'NOT_FOUND'
              : !['ativo', 'em curso'].includes(
                    student.status.trim().toLowerCase(),
                  ) || !isEmail(student.email)
                ? 'INELIGIBLE'
                : 'READY';
        if (student && status === 'READY') {
          if (seen.has(student.accountId)) status = 'DUPLICATE';
          else seen.add(student.accountId);
        }
        return {
          row: index + 1,
          name: row.name,
          status,
          ...(student
            ? {
                ra: student.ra,
                accountId: student.accountId,
                officialName: student.socialName || student.name,
              }
            : {}),
        };
      }),
    };
  }
  async studentHistory(ra: string) {
    return this.prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({
        where: { ra },
        select: { accountId: true },
      });
      if (!student) throw new NotFoundException('Aluno não encontrado.');
      return tx.attendance.findMany({
        where: { studentRa: ra, studentAccountId: student.accountId },
        select: {
          id: true,
          checkInAt: true,
          checkOutAt: true,
          status: true,
          event: {
            select: {
              id: true,
              title: true,
              startsAt: true,
              workloadMinutes: true,
              status: true,
            },
          },
          certificate: {
            select: {
              id: true,
              verificationCode: true,
              version: true,
              issuedAt: true,
              revokedAt: true,
              artifact: { select: { state: true, deliveryState: true } },
            },
          },
        },
        orderBy: [{ event: { startsAt: 'desc' } }, { id: 'asc' }],
      });
    });
  }
  async reissueCertificate(
    id: string,
    dto: import('./public-events.dto').ReissueCertificateDto,
    secretaryId: number,
  ) {
    return this.certificates.reissue(id, dto, secretaryId);
  }
  async certificateVersions(id: string) {
    return this.certificates.versionHistory(id);
  }
  async reissuePreview(
    id: string,
    dto: import('./public-events.dto').ReissueCertificateDto,
  ) {
    return this.certificates.reissuePreview(id, dto);
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
            version: true,
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
          name:
            (
              att.certificate?.payloadSnapshot as
                | { studentName?: string }
                | undefined
            )?.studentName ?? att.studentName,
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
                version: att.certificate.version,
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
          'Arquivo histÃ³rico encerrado para alteraÃ§Ãµes.',
        );
      if (await tx.certificate.count({ where: { participantId: id } }))
        throw new ConflictException('Certificado jÃ¡ emitido.');
      if (
        current.event.certificateEnabled &&
        current.event.certificatePolicies
      ) {
        const policy = (
          current.event.certificatePolicies as Record<string, unknown>
        )?.[role];
        if (!policy) {
          throw new BadRequestException(
            `Papel ${role} nÃ£o possui modelo de certificado configurado para este evento.`,
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
  async manualCertificate(
    eventId: string,
    dto: ManualCertificateDto,
    secretaryId: number,
  ) {
    if (
      dto.participationConfirmed !== true ||
      (dto.reason?.trim().length ?? 0) < 10
    )
      throw new BadRequestException(
        'Confirme a participação e informe uma justificativa de pelo menos 10 caracteres.',
      );
    return this.prisma.$transaction(
      async (tx) => {
        const { event } = await lockEventForMutation(tx, eventId);
        if (
          event.status === 'CANCELLED' ||
          event.status === 'SCHEDULED' ||
          !event.certificateEnabled
        )
          throw new ConflictException(
            'Evento não iniciado, cancelado ou sem emissão de certificados.',
          );
        const now = new Date();
        const retentionAt = new Date(event.endsAt.getTime() + 30 * 86400000);
        let seriesId = event.seriesId;
        if (seriesId) {
          await tx.$queryRaw`SELECT "id" FROM "EventSeries" WHERE "id" = ${seriesId} FOR SHARE`;
          const series = await tx.eventSeries.findUnique({
            where: { id: seriesId },
          });
          if (!series || series.purgedAt || series.retentionAt <= now)
            throw new ConflictException(
              'Prazo de atendimento do evento encerrado.',
            );
        } else if (retentionAt <= now) {
          throw new ConflictException(
            'Prazo de atendimento do evento encerrado.',
          );
        }
        if (dto.identityType === 'STUDENT' && dto.expectedAccountId) {
          await tx.$queryRaw`SELECT "ra" FROM "Student" WHERE "ra" = ${dto.ra?.trim() || ''} FOR SHARE`;
        }
        const student =
          dto.identityType === 'STUDENT'
            ? await tx.student.findUnique({
                where: { ra: dto.ra?.trim() || '' },
              })
            : null;
        if (
          dto.identityType === 'STUDENT' &&
          (!student ||
            !['ativo', 'em curso'].includes(
              student.status.trim().toLowerCase(),
            ))
        )
          throw new BadRequestException(
            'Aluno não encontrado ou inativo. Confira o RA.',
          );
        if (
          dto.expectedAccountId &&
          student?.accountId !== dto.expectedAccountId
        )
          throw new ConflictException(
            'O cadastro mudou. Busque e selecione o aluno novamente.',
          );
        if (!['STUDENT', 'EXTERNAL'].includes(dto.identityType))
          throw new BadRequestException('Identificação inválida.');
        let visitorId: string | null = null;
        let name = student?.socialName || student?.name || '';
        let course = student?.course || null;
        let email = student?.email || '';
        if (dto.identityType === 'EXTERNAL') {
          const cpf = dto.cpf?.replace(/\D/g, '') || '';
          email = dto.email?.trim().toLowerCase() || '';
          name = dto.name?.trim() || '';
          course = dto.course?.trim() || null;
          if (!validCpf(cpf) || !isEmail(email) || name.length < 3)
            throw new BadRequestException(
              'Informe nome, e-mail e CPF válidos.',
            );
          // Não crie uma segunda identidade para quem já possui conta de aluno.
          const existingStudent = await tx.student.findFirst({
            where: {
              OR: [
                { cpf },
                {
                  cpf: cpf.replace(
                    /(\d{3})(\d{3})(\d{3})(\d{2})/,
                    '$1.$2.$3-$4',
                  ),
                },
                { email: { equals: email, mode: 'insensitive' } },
              ],
            },
            select: { ra: true },
          });
          if (existingStudent)
            throw new ConflictException(
              'Pessoa já possui cadastro de aluno. Use a opção Aluno cadastrado e informe o RA.',
            );
          if (!seriesId) {
            const series = await tx.eventSeries.create({
              data: {
                title: event.title,
                slug: 'manual-' + randomUUID(),
                isAutomatic: true,
                published: false,
                startsAt: event.startsAt,
                endsAt: event.endsAt,
                retentionAt,
                courses: [],
              },
            });
            seriesId = series.id;
            await tx.event.update({
              where: { id: eventId },
              data: { seriesId },
            });
          }
          const emailHash = visitorIdentityHash(email);
          const cpfHash = visitorIdentityHash(`cpf:${cpf}`);
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${seriesId + emailHash}, 0))::text`;
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${seriesId + cpfHash}, 0))::text`;
          const byEmail = await tx.visitorRegistration.findUnique({
            where: { seriesId_emailHash: { seriesId, emailHash } },
          });
          const byCpf = await tx.visitorRegistration.findUnique({
            where: { seriesId_cpfHash: { seriesId, cpfHash } },
          });
          if (
            (byEmail?.cpfHash && byEmail.cpfHash !== cpfHash) ||
            (byCpf && byCpf.emailHash !== emailHash)
          )
            throw new ConflictException(
              'CPF ou e-mail já cadastrado com dados diferentes. Revise a identificação existente antes de emitir.',
            );
          const visitor =
            byCpf ||
            byEmail ||
            (await tx.visitorRegistration.create({
              data: {
                seriesId,
                name,
                email,
                emailHash,
                cpfHash,
                course,
                identifiedAt: now,
              },
            }));
          if (visitor.name.trim().toLowerCase() !== name.toLowerCase())
            throw new ConflictException(
              'O nome difere do cadastro existente para este CPF. Revise a identificação antes de emitir.',
            );
          if (!visitor.cpfHash || !visitor.identifiedAt) {
            await tx.visitorRegistration.update({
              where: { id: visitor.id },
              data: { cpfHash, identifiedAt: visitor.identifiedAt ?? now },
            });
          }
          visitorId = visitor.id;
          name = visitor.name;
          course = visitor.course;
        }
        if (!isEmail(email))
          throw new BadRequestException(
            'Cadastro sem e-mail válido para envio.',
          );
        const participant = await tx.eventParticipant.upsert({
          where: student
            ? { eventId_accountId: { eventId, accountId: student.accountId } }
            : { eventId_visitorId: { eventId, visitorId: visitorId! } },
          create: {
            eventId,
            accountId: student?.accountId,
            visitorId,
            name,
            course,
          },
          update: {},
        });
        let existingCertificate = await tx.certificate.findUnique({
          where: { activeParticipantId: participant.id },
        });
        if (existingCertificate?.revokedAt)
          throw new ConflictException(
            'Certificado revogado. Não é permitido reemitir ou reenviar por este fluxo.',
          );
        let attendance = await tx.attendance.findUnique({
          where: { participantId: participant.id },
        });
        if (!attendance && student) {
          attendance = await tx.attendance.findUnique({
            where: { eventId_studentRa: { eventId, studentRa: student.ra } },
          });
          if (attendance && attendance.studentAccountId !== student.accountId)
            throw new ConflictException(
              'Histórico vinculado a outra conta. Não é permitido reutilizar o RA.',
            );
        }
        if (attendance && !existingCertificate) {
          existingCertificate = await tx.certificate.findUnique({
            where: { activeAttendanceId: attendance.id },
          });
          if (existingCertificate?.revokedAt)
            throw new ConflictException(
              'Certificado revogado. Não é permitido reemitir por este fluxo.',
            );
        }
        if (attendance?.status !== 'CONFIRMED' || !attendance.checkOutAt) {
          const evidence: Prisma.InputJsonObject = {
            ...(attendance?.evidence &&
            typeof attendance.evidence === 'object' &&
            !Array.isArray(attendance.evidence)
              ? attendance.evidence
              : {}),
            manualCertificate: {
              decision: 'MANUAL',
              secretaryId,
              confirmedAt: now.toISOString(),
              missingCheckIn: !attendance?.checkInAt,
              missingCheckOut: !attendance?.checkOutAt,
            },
          };
          const data = {
            participantId: participant.id,
            checkInAt: attendance?.checkInAt ?? now,
            checkOutAt: attendance?.checkOutAt ?? now,
            status: 'CONFIRMED' as const,
            evidence,
          };
          attendance = attendance
            ? await tx.attendance.update({ where: { id: attendance.id }, data })
            : await tx.attendance.create({
                data: {
                  ...data,
                  eventId,
                  studentRa: student?.ra,
                  studentAccountId: student?.accountId,
                  studentRefRa: student?.ra,
                  studentName: name,
                  studentCourse: course || 'Participante/ouvinte',
                },
              });
        } else if (!attendance.participantId) {
          attendance = await tx.attendance.update({
            where: { id: attendance.id },
            data: { participantId: participant.id },
          });
        }
        const certificate = await this.certificates.issueCertificate(
          attendance.id,
          tx,
        );
        if (!certificate || certificate.revokedAt)
          throw new ConflictException('Não foi possível emitir o certificado.');
        const previousArtifact = await tx.certificateArtifact.findUnique({
          where: { certificateId: certificate.id },
        });
        const artifact =
          previousArtifact ??
          (await tx.certificateArtifact.create({
            data: { certificateId: certificate.id },
          }));
        if (!certificate.participantId) {
          await tx.certificate.update({
            where: { id: certificate.id },
            data: {
              participantId: participant.id,
              activeParticipantId: participant.id,
            },
          });
        }
        await tx.eventAudit.create({
          data: {
            eventId,
            subjectId: certificate.id,
            secretaryId,
            reason: dto.reason.trim(),
            action: existingCertificate
              ? 'MANUAL_CERTIFICATE_ALREADY_ISSUED'
              : 'MANUAL_CERTIFICATE_ISSUED',
          },
        });
        return {
          certificateId: certificate.id,
          verificationCode: certificate.verificationCode,
          recipientName: name,
          email,
          alreadyIssued: Boolean(existingCertificate),
          deliveryState: artifact.deliveryState,
          artifactState: artifact.state,
          message:
            existingCertificate && previousArtifact
              ? 'Certificado já existente. Não foi criado outro nem duplicado o envio.'
              : 'Participação confirmada administrativamente. Certificado e envio por e-mail enfileirados.',
        };
      },
      { maxWait: 5000, timeout: 15000 },
    );
  }
  async bulkManualCheckout(
    eventId: string,
    dto: BulkManualCheckoutDto,
    secretaryId: number,
  ) {
    const ids = dto.attendanceIds;
    if (
      dto.confirmed !== true ||
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 50 ||
      new Set(ids).size !== ids.length ||
      (dto.reason?.trim().length ?? 0) < 10
    )
      throw new BadRequestException(
        'Confirme a participação, selecione até 50 presenças distintas e informe a justificativa.',
      );
    return this.prisma.$transaction(
      async (tx) => {
        const { event } = await lockEventForMutation(tx, eventId);
        if (event.status === 'CANCELLED')
          throw new ConflictException(
            'Evento cancelado não permite confirmar saídas.',
          );
        if (event.seriesId) {
          const series = await tx.eventSeries.findUnique({
            where: { id: event.seriesId },
          });
          if (!series || series.purgedAt || series.retentionAt <= new Date())
            throw new ConflictException('Prazo de atendimento encerrado.');
        }
        const rows = await tx.attendance.findMany({
          where: { eventId, id: { in: ids } },
          select: { id: true, checkInAt: true, checkOutAt: true, status: true },
        });
        if (rows.length !== ids.length)
          throw new BadRequestException(
            'Uma presença não existe ou pertence a outro evento. Nenhuma alteração deste lote foi salva.',
          );
        if (rows.some((row) => !row.checkInAt))
          throw new BadRequestException(
            'Todas as presenças precisam de entrada registrada. Nenhuma alteração deste lote foi salva.',
          );
        const alreadyConfirmed = new Set(
          rows
            .filter((row) => row.checkOutAt && row.status === 'CONFIRMED')
            .map((row) => row.id),
        );
        for (const id of ids) {
          if (alreadyConfirmed.has(id)) continue;
          await this.manual(
            eventId,
            {
              attendanceId: id,
              checkpoint: 'CHECK_OUT',
              reason: dto.reason.trim(),
            },
            secretaryId,
            tx,
          );
        }
        await tx.eventAudit.create({
          data: {
            eventId,
            secretaryId,
            action: 'BULK_MANUAL_CHECK_OUT',
            subjectId: randomUUID(),
            reason: `${ids.length} presenças processadas em lote. ${dto.reason.trim()}`,
          },
        });
        return {
          success: true,
          processedIds: ids,
          confirmedCount: ids.length - alreadyConfirmed.size,
          alreadyConfirmedCount: alreadyConfirmed.size,
        };
      },
      { maxWait: 5000, timeout: 60000 },
    );
  }
  async manual(
    eventId: string,
    dto: ManualPresenceDto,
    secretaryId: number,
    client?: Prisma.TransactionClient,
  ) {
    if (Boolean(dto.participantId) === Boolean(dto.attendanceId))
      throw new BadRequestException(
        'Informe apenas um participante ou uma presença.',
      );
    if ((dto.reason?.trim().length ?? 0) < 10)
      throw new BadRequestException('Descreva a justificativa presencial.');
    const run = async (tx: Prisma.TransactionClient) => {
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
            'Arquivo histÃ³rico encerrado para alteraÃ§Ãµes.',
          );
      }
      const selectedAttendance = dto.attendanceId
        ? await tx.attendance.findUnique({ where: { id: dto.attendanceId } })
        : null;
      if (
        dto.attendanceId &&
        (!selectedAttendance || selectedAttendance.eventId !== eventId)
      )
        throw new NotFoundException('Presença não encontrada neste evento.');
      let participantId =
        dto.participantId ?? selectedAttendance?.participantId;
      if (
        !participantId &&
        selectedAttendance?.studentAccountId &&
        event &&
        event.status !== 'CANCELLED'
      ) {
        const originalStudent = await tx.student.findUnique({
          where: { accountId: selectedAttendance.studentAccountId },
        });
        if (
          !originalStudent ||
          originalStudent.ra !== selectedAttendance.studentRa
        )
          throw new ConflictException(
            'Identidade original indisponível. Não é permitido reutilizar matrícula.',
          );
        const linked = await tx.eventParticipant.upsert({
          where: {
            eventId_accountId: {
              eventId,
              accountId: originalStudent.accountId,
            },
          },
          create: {
            eventId,
            accountId: originalStudent.accountId,
            name: selectedAttendance.studentName,
            course: selectedAttendance.studentCourse,
          },
          update: {},
        });
        participantId = linked.id;
        await tx.attendance.update({
          where: { id: selectedAttendance.id },
          data: { participantId },
        });
      }
      const person = participantId
        ? await tx.eventParticipant.findUnique({
            where: { id: participantId },
            include: { visitor: { include: { series: true } } },
          })
        : null;
      if (
        !event ||
        event.status === 'CANCELLED' ||
        !person ||
        person.eventId !== eventId ||
        person.visitor?.series.purgedAt
      )
        throw new ConflictException('Participante/atividade indisponÃ­vel.');
      // Registro manual nÃ£o simula QR nem GPS e preserva timestamps anteriores.
      const previous =
        selectedAttendance ??
        (await tx.attendance.findUnique({
          where: { participantId: person.id },
        }));
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
          throw new BadRequestException(
            'Entrada obrigatÃ³ria antes da saÃ­da.',
          );
        if (!previous.checkOutAt)
          await tx.attendance.update({
            where: { id: previous.id },
            data: {
              checkOutAt: new Date(),
              status: 'CONFIRMED',
              evidence: {
                ...(previous.evidence &&
                typeof previous.evidence === 'object' &&
                !Array.isArray(previous.evidence)
                  ? previous.evidence
                  : {}),
                manualPresence: {
                  decision: 'MANUAL',
                  checkpoint: 'CHECK_OUT',
                  secretaryId,
                  confirmedAt: new Date().toISOString(),
                },
              },
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
    };
    return client ? run(client) : this.prisma.$transaction(run);
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
      throw new BadRequestException('InscriÃ§Ã£o nÃ£o pertence Ã  atividade.');
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
    if (!row) throw new NotFoundException('Certificado nÃ£o encontrado.');
    if (row.revokedAt) throw new ConflictException('Certificado revogado.');
    if (row.artifact?.state !== 'READY' || !row.artifact.storageKey)
      throw new ConflictException(
        'PDF em processamento. Tente novamente em instantes.',
      );
    const buffer = await this.storage.get(row.artifact.storageKey, true);
    const current = await this.prisma.certificate.findUnique({
      where: { id },
      select: { revokedAt: true, activeAttendanceId: true },
    });
    if (!current || current.revokedAt || !current.activeAttendanceId)
      throw new ConflictException('Certificado revogado.');
    return {
      buffer,
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
          reason: `${ids.length} inscriÃ§Ãµes; certificados e histÃ³rico mÃ­nimo preservados.`,
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
    if (!event) throw new NotFoundException('Evento nÃ£o encontrado');

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
      message: 'AvaliaÃ§Ã£o enviada com sucesso! Obrigado pelo seu feedback.',
    };
  }

  async getFeedbackMetrics(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true },
    });
    if (!event) throw new NotFoundException('Evento nÃ£o encontrado');

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
