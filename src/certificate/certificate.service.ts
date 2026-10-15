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
        where: { attendanceId },
      });
      if (existingByAttendance) {
        return existingByAttendance;
      }

      // 4. Idempotência por [eventId, studentRa]
      const existingByRa = attendance.studentRa
        ? await client.certificate.findUnique({
            where: {
              eventId_studentRa: {
                eventId: attendance.eventId,
                studentRa: attendance.studentRa,
              },
            },
          })
        : null;
      if (existingByRa) {
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
      const snapshot = attendance.event.seriesId
        ? await this.snapshotV2(client, attendance)
        : buildCertificateSnapshot(
            { ...attendance, studentRa: attendance.studentRa || '' },
            attendance.event,
          );

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
            where: { attendanceId: attendance.id },
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

  private async snapshotV2(
    client: Prisma.TransactionClient,
    attendance: Prisma.AttendanceGetPayload<{ include: { event: true } }>,
  ): Promise<CertificateSnapshot> {
    if (attendance.participantId)
      await client.$queryRaw`SELECT "id" FROM "EventParticipant" WHERE "id" = ${attendance.participantId} FOR UPDATE`;
    const participant = attendance.participantId
      ? await client.eventParticipant.findUnique({
          where: { id: attendance.participantId },
        })
      : null;
    if (!participant)
      throw new ConflictException('Participante não configurado para emissão.');
    const policy = (
      attendance.event.certificatePolicies as unknown as CertificatePolicy
    )?.[participant.role as keyof CertificatePolicy];
    if (!policy)
      throw new ConflictException('Modelo de certificado não configurado.');
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
    const series = await client.eventSeries.findUniqueOrThrow({
      where: { id: attendance.event.seriesId! },
    });
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
      seriesTitle: series.title,
      location: attendance.event.location,
      startsAt: attendance.event.startsAt.toISOString(),
      endsAt: attendance.event.endsAt.toISOString(),
      promoter: attendance.event.promoter || '',
      template: { id: template.id, version: template.version, ...config },
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
        revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
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
