import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  ConflictException,
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
      const existingByRa = await client.certificate.findUnique({
        where: {
          eventId_studentRa: {
            eventId: attendance.eventId,
            studentRa: attendance.studentRa,
          },
        },
      });
      if (existingByRa) {
        return existingByRa;
      }

      // 5. Vincular studentRefRa apenas se o estudante atual ainda possuir a mesma conta original
      const currentStudent = await client.student.findUnique({
        where: { ra: attendance.studentRa },
      });
      const studentRefRa =
        currentStudent &&
        currentStudent.accountId === attendance.studentAccountId
          ? currentStudent.ra
          : null;

      // 6. Snapshot imutável
      const snapshot = buildCertificateSnapshot(attendance, attendance.event);

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

    const buffer = await this.pdfGenerator.generatePdf(certView);
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
