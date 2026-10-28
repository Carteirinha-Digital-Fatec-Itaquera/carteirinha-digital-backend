import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { Prisma, type Certificate } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { TokenPayload } from '../auth/dto/payload.dto';
import {
  generateVerificationCode,
  isValidVerificationCode,
  normalizeVerificationCode,
} from './verification-code';
import {
  buildCertificateSnapshot,
  type CertificateSnapshot,
} from './certificate.snapshot';
import type {
  CertificateListItem,
  CertificateView,
  CertificateVerificationResponse,
} from './dto/view-certificate.dto';
import { PdfGeneratorService } from './pdf-generator.service';
import type {
  CertificatePolicy,
  TemplateConfig,
} from '../public-events/event-catalog.service';
import { EventStorageService } from '../public-events/event-storage.service';
import { randomUUID } from 'node:crypto';
import type { ReissueCertificateDto } from '../public-events/public-events.dto';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ActiveStudent {
  ra: string;
  accountId: string;
  name: string;
  course: string;
  status: string;
}

@Injectable()
export class CertificateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfGenerator: PdfGeneratorService,
    @Optional() private readonly storage?: EventStorageService,
  ) {}

  public async issueCertificate(
    attendanceId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Certificate | null> {
    const run = async (client: Prisma.TransactionClient) => {
      const attendance = await client.attendance.findUnique({
        where: { id: attendanceId },
        include: { event: true },
      });

      if (!attendance) {
        return null;
      }

      // Regras de negócio da V1:
      // 1. Somente CONFIRMED
      if (attendance.status !== 'CONFIRMED' || !attendance.checkOutAt) {
        return null;
      }

      // 2. Evento precisa ter certificado habilitado e não estar CANCELLED
      if (
        !attendance.event.certificateEnabled ||
        attendance.event.status === 'CANCELLED'
      ) {
        return null;
      }

      // 3. Idempotência por attendanceId
      const existingByAttendance = await client.certificate.findUnique({
        where: { activeAttendanceId: attendanceId },
      });
      if (existingByAttendance) {
        if (
          existingByAttendance.studentAccountId !== attendance.studentAccountId
        )
          throw new ConflictException('Conflito de identidade de certificado');
        return existingByAttendance;
      }

      // 4. Idempotência por [eventId, studentRa]
      const existingByRa = attendance.studentRa
        ? await client.certificate.findFirst({
            where: {
              eventId: attendance.eventId,
              studentRa: attendance.studentRa,
              activeAttendanceId: { not: null },
            },
          })
        : null;
      if (existingByRa) {
        if (existingByRa.studentAccountId !== attendance.studentAccountId)
          throw new ConflictException('Conflito de identidade de certificado');
        return existingByRa;
      }

      // 5. Vincular studentRefRa apenas se o estudante atual ainda possuir a mesma conta original
      const currentStudent = attendance.studentRa
        ? await client.student.findUnique({
            where: { ra: attendance.studentRa },
          })
        : null;
      const studentRefRa =
        currentStudent &&
        currentStudent.accountId === attendance.studentAccountId
          ? currentStudent.ra
          : null;

      // 6. Snapshot imutável
      const customPolicy = attendance.event
        .certificatePolicies as unknown as CertificatePolicy;
      const hasCustomPolicy = Boolean(
        customPolicy &&
        typeof customPolicy === 'object' &&
        Object.keys(customPolicy).length > 0 &&
        (customPolicy.ATTENDEE || customPolicy.SPEAKER),
      );

      const snapshot = hasCustomPolicy
        ? await this.snapshotV2(client, attendance)
        : buildCertificateSnapshot(
            { ...attendance, studentRa: attendance.studentRa || '' },
            attendance.event,
          );

      if (studentRefRa && currentStudent?.socialName)
        snapshot.studentName = currentStudent.socialName;

      if (snapshot.version === 2) {
        // ON CONFLICT evita abortar a transação de presença durante uma colisão.
        for (let attempt = 0; attempt < 5; attempt++) {
          const id = randomUUID();
          const inserted = await client.certificate.createMany({
            data: [
              {
                id,
                eventId: attendance.eventId,
                participantId: attendance.participantId,
                studentRa: attendance.studentRa,
                studentAccountId: attendance.studentAccountId,
                studentRefRa,
                attendanceId: attendance.id,
                activeAttendanceId: attendance.id,
                activeParticipantId: attendance.participantId,
                verificationCode: generateVerificationCode(),
                payloadSnapshot: snapshot as unknown as Prisma.InputJsonValue,
              },
            ],
            skipDuplicates: true,
          });
          if (inserted.count === 1) {
            await client.certificateArtifact.create({
              data: { certificateId: id },
            });
            return client.certificate.findUniqueOrThrow({ where: { id } });
          }
          const existing = await client.certificate.findUnique({
            where: { activeAttendanceId: attendance.id },
          });
          if (existing && existing.participantId === attendance.participantId)
            return existing;
        }
        throw new ConflictException(
          'Não foi possível emitir um código único de certificado.',
        );
      }

      // 7. Geração do código com tentativa em caso de colisão de código
      let certificate: Certificate | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateVerificationCode();
        try {
          certificate = await client.certificate.create({
            data: {
              eventId: attendance.eventId,
              studentRa: attendance.studentRa,
              studentAccountId: attendance.studentAccountId,
              studentRefRa,
              participantId: attendance.participantId,
              attendanceId: attendance.id,
              activeAttendanceId: attendance.id,
              activeParticipantId: attendance.participantId,
              verificationCode: code,
              payloadSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            },
          });
          break;
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            const targets = (error.meta?.target as string[]) || [];
            if (targets.includes('verificationCode')) {
              // Colisão de código: gera outro
              continue;
            }
            // Colisão de attendanceId ou eventId_studentRa: busca o registro criado concorrentemente
            const recovered = await client.certificate.findFirst({
              where: {
                activeAttendanceId: { not: null },
                OR: [
                  { attendanceId: attendance.id },
                  {
                    eventId: attendance.eventId,
                    studentRa: attendance.studentRa,
                  },
                ],
              },
            });
            if (
              recovered &&
              recovered.studentAccountId === attendance.studentAccountId
            ) {
              return recovered;
            }
            throw new ConflictException(
              'Conflito de identidade de certificado',
            );
          }
          throw error;
        }
      }

      if (certificate) {
        await client.certificateArtifact.create({
          data: {
            certificateId: certificate.id,
            state: 'PENDING_RENDER',
            deliveryState: 'PENDING',
          },
        });
      }

      return certificate;
    };

    if (tx) {
      return run(tx);
    }

    return this.prisma.$transaction(run, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5000,
      timeout: 10000,
    });
  }

  async reissue(id: string, dto: ReissueCertificateDto, secretaryId: number) {
    dto.name = dto.name.trim().replace(/\s+/g, ' ');
    if (dto.course) dto.course = dto.course.trim().replace(/\s+/g, ' ');
    if (dto.saveSocialName && dto.correctionType !== 'SOCIAL_NAME')
      throw new BadRequestException(
        'Selecione correção de nome social para atualizar o cadastro.',
      );
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT e."id" FROM "Event" e JOIN "Certificate" c ON c."eventId" = e."id" WHERE c."id" = ${id} FOR UPDATE OF e`;
        await tx.$queryRaw`SELECT "id" FROM "Certificate" WHERE "id" = ${id} FOR UPDATE`;
        const previous = await tx.certificate.findUnique({
          where: { id },
          include: { event: true, attendance: true },
        });
        if (!previous)
          throw new NotFoundException('Certificado não encontrado.');
        const replay = await tx.certificate.findUnique({
          where: { reissueKey: dto.requestId },
        });
        if (replay) {
          const snapshot =
            replay.payloadSnapshot as unknown as CertificateSnapshot;
          if (
            replay.replacesId !== id ||
            snapshot.studentName !== dto.name ||
            (dto.course && snapshot.course !== dto.course)
          )
            throw new ConflictException(
              'Solicitação já utilizada com dados diferentes.',
            );
          return {
            certificateId: replay.id,
            version: replay.version,
            verificationCode: replay.verificationCode,
          };
        }
        if (
          previous.revokedAt ||
          !previous.activeAttendanceId ||
          previous.version !== dto.expectedVersion ||
          previous.event.status === 'CANCELLED' ||
          previous.attendance.status !== 'CONFIRMED'
        )
          throw new ConflictException(
            'A versão ou a participação mudou. Atualize antes de reemitir.',
          );
        if (!previous.studentAccountId || !previous.studentRa)
          throw new ConflictException(
            'Esta correção exige uma conta de aluno identificada.',
          );
        await tx.$queryRaw`SELECT "ra" FROM "Student" WHERE "accountId" = ${previous.studentAccountId} FOR UPDATE`;
        const student = await tx.student.findUnique({
          where: { accountId: previous.studentAccountId },
        });
        if (!student || student.ra !== previous.studentRa)
          throw new ConflictException(
            'Conta original indisponível. Não é permitido reutilizar matrícula.',
          );
        await tx.$queryRaw`SELECT "id" FROM "CertificateArtifact" WHERE "certificateId" = ${id} FOR UPDATE`;
        const artifact = await tx.certificateArtifact.findUnique({
          where: { certificateId: id },
        });
        if (
          artifact &&
          ((artifact.leaseUntil && artifact.leaseUntil > new Date()) ||
            ['DISPATCHING', 'AMBIGUOUS'].includes(artifact.deliveryState))
        )
          throw new ConflictException(
            'Envio em andamento ou incerto. Aguarde ou reconcilie a entrega antes de reemitir.',
          );
        const snapshot =
          previous.payloadSnapshot as unknown as CertificateSnapshot;
        const corrected = {
          ...snapshot,
          studentName: dto.name,
          ...(dto.course ? { course: dto.course } : {}),
        };
        if (dto.saveSocialName)
          await tx.student.update({
            where: { accountId: student.accountId },
            data: { socialName: dto.name },
          });
        if (previous.participantId)
          await tx.eventParticipant.update({
            where: { id: previous.participantId },
            data: {
              name: dto.name,
              ...(dto.course ? { course: dto.course } : {}),
            },
          });
        await tx.certificate.update({
          where: { id },
          data: {
            revokedAt: new Date(),
            revocationReason: 'REPLACED',
            activeAttendanceId: null,
            activeParticipantId: null,
          },
        });
        if (artifact)
          await tx.certificateArtifact.update({
            where: { id: artifact.id },
            data: {
              state: 'REVOKED',
              deliveryState: 'EXPIRED',
              leaseToken: null,
              leaseUntil: null,
            },
          });
        const next = await tx.certificate.create({
          data: {
            eventId: previous.eventId,
            attendanceId: previous.attendanceId,
            participantId: previous.participantId,
            studentRa: previous.studentRa,
            studentAccountId: previous.studentAccountId,
            studentRefRa: student.ra,
            activeAttendanceId: previous.attendanceId,
            activeParticipantId: previous.participantId,
            version: previous.version + 1,
            replacesId: id,
            reissueKey: dto.requestId,
            reissuedById: secretaryId,
            verificationCode: generateVerificationCode(),
            payloadSnapshot: corrected,
          },
        });
        await tx.certificateArtifact.create({
          data: { certificateId: next.id },
        });
        await tx.eventAudit.create({
          data: {
            eventId: previous.eventId,
            subjectId: next.id,
            secretaryId,
            action: 'CERTIFICATE_REISSUED',
            reason: `${dto.correctionType}: ${dto.reason.trim()} [substitui ${id}]`,
          },
        });
        return {
          certificateId: next.id,
          version: next.version,
          verificationCode: next.verificationCode,
        };
      },
      { timeout: 15000 },
    );
  }

  async versionHistory(id: string) {
    const certificate = await this.prisma.certificate.findUnique({
      where: { id },
      select: { attendanceId: true, studentAccountId: true },
    });
    if (!certificate)
      throw new NotFoundException('Certificado não encontrado.');
    return this.prisma.certificate.findMany({
      where: {
        attendanceId: certificate.attendanceId,
        studentAccountId: certificate.studentAccountId,
      },
      select: {
        id: true,
        version: true,
        verificationCode: true,
        issuedAt: true,
        revokedAt: true,
        revocationReason: true,
        reissuedById: true,
      },
      orderBy: { version: 'desc' },
    });
  }
  async reissuePreview(id: string, dto: ReissueCertificateDto) {
    dto.name = dto.name.trim().replace(/\s+/g, ' ');
    const cert = await this.prisma.certificate.findUnique({ where: { id } });
    if (!cert || cert.revokedAt || !cert.activeAttendanceId)
      throw new NotFoundException('Versão vigente não encontrada.');
    return this.pdfGenerator.generatePdf({
      id: 'preview',
      eventId: cert.eventId,
      attendanceId: cert.attendanceId,
      issuedAt: new Date().toISOString(),
      revokedAt: null,
      verificationCode: 'DEMONSTRACAO-SEM-VALIDADE',
      payloadSnapshot: {
        ...(cert.payloadSnapshot as unknown as CertificateSnapshot),
        studentName: dto.name,
        ...(dto.course ? { course: dto.course } : {}),
      },
    });
  }

  private async snapshotV2(
    client: Prisma.TransactionClient,
    attendance: Prisma.AttendanceGetPayload<{ include: { event: true } }>,
  ): Promise<CertificateSnapshot> {
    if (attendance.participantId)
      await client.$queryRaw`SELECT "id" FROM "EventParticipant" WHERE "id" = ${attendance.participantId} FOR UPDATE`;
    let participant = attendance.participantId
      ? await client.eventParticipant.findUnique({
          where: { id: attendance.participantId },
        })
      : null;
    if (!participant && attendance.studentAccountId) {
      participant = await client.eventParticipant.findUnique({
        where: {
          eventId_accountId: {
            eventId: attendance.eventId,
            accountId: attendance.studentAccountId,
          },
        },
      });
    }
    if (!participant && attendance.studentRa) {
      participant = await client.eventParticipant.create({
        data: {
          eventId: attendance.eventId,
          accountId: attendance.studentAccountId,
          name: attendance.studentName,
          course: attendance.studentCourse,
          role: 'ATTENDEE',
        },
      });
    }
    if (!participant)
      throw new ConflictException('Participante não configurado para emissão.');
    const role = (participant.role || 'ATTENDEE') as keyof CertificatePolicy;
    const policy = (
      attendance.event.certificatePolicies as unknown as CertificatePolicy
    )?.[role];
    if (!policy)
      throw new ConflictException(
        `Papel ${role} não possui modelo de certificado configurado para este evento.`,
      );
    const template = await client.certificateTemplate.findUnique({
      where: { id: policy.templateId },
    });
    if (
      !template ||
      !['PUBLISHED', 'ARCHIVED'].includes(template.status) ||
      template.role !== participant.role
    )
      throw new ConflictException('Modelo não disponível para emissão.');
    const signers = await client.certificateSigner.findMany({
      where: { id: { in: policy.signerIds } },
    });
    if (signers.length !== policy.signerIds.length)
      throw new ConflictException(
        'Assinatura indisponível. Procure a Secretaria.',
      );
    const config = template.config as unknown as TemplateConfig;
    const series = attendance.event.seriesId
      ? await client.eventSeries.findUnique({
          where: { id: attendance.event.seriesId },
        })
      : null;
    return {
      ...buildCertificateSnapshot(
        {
          studentName: participant.name,
          studentRa: attendance.studentRa || '',
          studentCourse: participant.course || '',
        },
        attendance.event,
      ),
      version: 2,
      rendererVersion: 'technology-week/1',
      role: participant.role,
      seriesTitle: series?.title || attendance.event.title,
      location: attendance.event.location,
      startsAt: attendance.event.startsAt.toISOString(),
      endsAt: attendance.event.endsAt.toISOString(),
      promoter: attendance.event.promoter || '',
      template: {
        id: template.id,
        version: template.version,
        ...config,
        ...(config.design === 'TECHNOLOGY_BLUE_2026_DARK' &&
        !config.wordingVersion
          ? { wordingVersion: 'LECTURE_LISTENER_2026' as const }
          : {}),
      },
      signers: policy.signerIds.map((id) => {
        const signer = signers.find((s) => s.id === id)!;
        return {
          id,
          name: signer.name,
          title: signer.title,
          assetId: signer.assetId,
        };
      }),
    };
  }

  public async getStudentCertificates(
    user: TokenPayload,
  ): Promise<CertificateListItem[]> {
    return this.prisma.$transaction(async (tx) => {
      const student = await this.activeStudent(tx, user);

      const rows = await tx.certificate.findMany({
        where: {
          studentRefRa: student.ra,
          studentAccountId: student.accountId,
          revokedAt: null,
          activeAttendanceId: { not: null },
        },
        orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }],
      });

      return rows.map((row) => {
        const snapshot = row.payloadSnapshot as unknown as CertificateSnapshot;
        return {
          id: row.id,
          eventId: row.eventId,
          verificationCode: row.verificationCode,
          eventTitle: snapshot.eventTitle,
          eventDate: snapshot.eventDate,
          workload: snapshot.workload,
          issuedAt: row.issuedAt.toISOString(),
          revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
        };
      });
    });
  }

  public async getStudentCertificate(
    id: string,
    user: TokenPayload,
  ): Promise<CertificateView> {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('ID de certificado inválido');
    }

    return this.prisma.$transaction(async (tx) => {
      const student = await this.activeStudent(tx, user);

      const row = await tx.certificate.findUnique({
        where: { id },
      });

      if (
        !row ||
        row.revokedAt ||
        !row.activeAttendanceId ||
        row.studentAccountId !== student.accountId ||
        row.studentRefRa !== student.ra
      ) {
        throw new NotFoundException('Certificado não encontrado');
      }

      const snapshot = row.payloadSnapshot as unknown as CertificateSnapshot;
      return {
        id: row.id,
        eventId: row.eventId,
        attendanceId: row.attendanceId,
        verificationCode: row.verificationCode,
        payloadSnapshot: snapshot,
        issuedAt: row.issuedAt.toISOString(),
        revokedAt: null,
      };
    });
  }

  public async verifyCertificate(
    code: string,
  ): Promise<CertificateVerificationResponse> {
    const normalized = normalizeVerificationCode(code);
    if (!isValidVerificationCode(normalized)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'INVALID_CODE_FORMAT',
        message: 'Código de verificação em formato inválido',
      });
    }

    const cert = await this.prisma.certificate.findUnique({
      where: { verificationCode: normalized },
    });

    if (!cert) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        code: 'CERTIFICATE_NOT_FOUND',
        message: 'Certificado não encontrado',
      });
    }

    if (cert.revokedAt) {
      return {
        valid: false,
        code: cert.verificationCode,
        revoked: true,
        message: 'Certificado revogado',
      };
    }

    const snapshot = cert.payloadSnapshot as unknown as CertificateSnapshot;
    return {
      valid: true,
      code: cert.verificationCode,
      studentName: snapshot.studentName,
      eventTitle: snapshot.eventTitle,
      eventDate: snapshot.eventDate,
      workload: snapshot.workload,
      issuedAt: cert.issuedAt.toISOString(),
      institution: snapshot.institution,
    };
  }

  public async generatePdf(
    id: string,
    user: TokenPayload,
  ): Promise<{ buffer: Buffer; verificationCode: string }> {
    const certView = await this.getStudentCertificate(id, user);

    if (certView.revokedAt) {
      throw new ConflictException('Certificado revogado não pode ser baixado');
    }

    let buffer: Buffer;
    if (certView.payloadSnapshot.version === 2) {
      const artifact = await this.prisma.certificateArtifact.findUnique({
        where: { certificateId: id },
      });
      if (artifact?.state !== 'READY' || !artifact.storageKey || !this.storage)
        throw new ConflictException(
          'PDF em processamento. Tente novamente em instantes.',
        );
      buffer = await this.storage.get(artifact.storageKey, true);
    } else buffer = await this.pdfGenerator.generatePdf(certView);
    const current = await this.prisma.certificate.findUnique({
      where: { id },
      select: { revokedAt: true, activeAttendanceId: true },
    });
    if (!current || current.revokedAt || !current.activeAttendanceId)
      throw new ConflictException('Certificado revogado não pode ser baixado');
    return {
      buffer,
      verificationCode: certView.verificationCode,
    };
  }

  private async activeStudent(
    tx: Prisma.TransactionClient,
    user: TokenPayload,
  ): Promise<ActiveStudent> {
    if (user.role !== 'student') {
      throw new ForbiddenException(
        'Apenas alunos podem consultar certificados',
      );
    }
    if (typeof user.sub !== 'string' || !user.accountId) {
      throw new UnauthorizedException('Identidade de aluno inválida');
    }

    const [student] = await tx.$queryRaw<ActiveStudent[]>`
      SELECT "ra", "accountId", "name", "course", "status" FROM "Student" WHERE "ra" = ${user.sub} FOR SHARE`;

    if (
      !student ||
      student.accountId !== user.accountId ||
      (student.status !== 'Ativo' && student.status !== 'Em curso')
    ) {
      throw new ForbiddenException('Conta de aluno inativa ou desvinculada');
    }

    return student;
  }
}
