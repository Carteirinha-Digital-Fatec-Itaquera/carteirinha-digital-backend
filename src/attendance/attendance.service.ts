import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  Attendance,
  CheckpointType,
  Event,
  EventCheckpoint,
  Prisma,
  Student,
} from '@prisma/client';
import { isUUID } from 'class-validator';
import { loadAuthSecrets } from '../auth/auth.config';
import type { TokenPayload } from '../auth/dto/payload.dto';
import { PrismaService } from '../database/prisma.service';
import type {
  AttendanceScanResponse,
  AttendanceSummary,
  AttendanceView,
  MyAttendanceView,
} from './dto/view-attendance.dto';

type ActiveStudent = Pick<
  Student,
  'ra' | 'accountId' | 'name' | 'course' | 'status'
>;
interface QrClaims {
  eventId: string;
  checkpoint: CheckpointType;
  checkpointVersion: number;
  jti: string;
  iat: number;
  exp: number;
}
const attendanceSelect = {
  id: true,
  eventId: true,
  event: { select: { title: true } },
  checkInAt: true,
  checkOutAt: true,
  status: true,
} satisfies Prisma.AttendanceSelect;

@Injectable()
export class AttendanceService {
  private readonly qrSecret: string;
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {
    this.qrSecret = loadAuthSecrets().attendanceQrSecret;
  }

  async scan(
    qrToken: string,
    user: TokenPayload,
  ): Promise<AttendanceScanResponse> {
    const claims = await this.verifyQr(qrToken);
    return this.prisma.$transaction(
      async (tx) => {
        const student = await this.activeStudent(tx, user);
        // Serializa o par mesmo antes de existir a linha. A chave única permanece no banco.
        // Colisão de hash apenas serializa pares extras; não altera a identidade consultada.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([claims.eventId, student.ra])}, 0))::text`;
        // Mesma ordem de escrita da #25: checkpoint antes de evento. FOR SHARE impede
        // fechamento/reabertura enquanto validamos e gravamos a presença.
        const checkpoints = await tx.$queryRaw<EventCheckpoint[]>`
        SELECT * FROM "EventCheckpoint"
        WHERE "eventId" = ${claims.eventId} AND "type" = ${claims.checkpoint}::"CheckpointType"
        FOR SHARE`;
        const events = await tx.$queryRaw<
          Event[]
        >`SELECT * FROM "Event" WHERE "id" = ${claims.eventId} FOR SHARE`;
        const event = events[0];
        const checkpoint = checkpoints[0];
        if (!event) throw new NotFoundException('Evento não encontrado');
        if (event.status === 'CANCELLED')
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            code: 'EVENT_CANCELLED',
            message: 'Evento cancelado',
          });
        if (
          !checkpoint ||
          !checkpoint.isOpen ||
          event.status !== 'IN_PROGRESS'
        ) {
          throw new BadRequestException({
            statusCode: 400,
            error: 'Bad Request',
            code: 'CHECKPOINT_CLOSED',
            message: 'Checkpoint encerrado',
          });
        }
        if (checkpoint.version !== claims.checkpointVersion) {
          throw new BadRequestException({
            statusCode: 400,
            error: 'Bad Request',
            code: 'QR_VERSION_MISMATCH',
            message: 'QR Code inválido para este período',
          });
        }
        const now = new Date();
        // Uma requisição pode esperar por locks e vencer durante a espera.
        if (claims.exp * 1000 <= now.getTime()) this.expiredQr();
        const where = {
          eventId_studentRa: { eventId: event.id, studentRa: student.ra },
        };
        const previous = await tx.attendance.findUnique({ where });
        if (
          previous &&
          (previous.studentAccountId !== student.accountId ||
            previous.studentRefRa !== student.ra)
        ) {
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            code: 'RA_REUSE_HISTORY_CONFLICT',
            message: 'Histórico vinculado a outra conta. Procure a Secretaria.',
          });
        }
        if (claims.checkpoint === 'CHECK_IN') {
          if (previous?.checkInAt)
            return this.duplicate('ALREADY_CHECKED_IN', now);
          const data = {
            studentRa: student.ra,
            studentRefRa: student.ra,
            studentAccountId: student.accountId,
            studentName: student.name,
            studentCourse: student.course,
            checkInAt: now,
            status: 'CHECKED_IN' as const,
          };
          if (previous) {
            await tx.attendance.update({ where, data });
          } else {
            await tx.attendance.create({
              data: { ...data, eventId: event.id },
            });
          }
          return {
            success: true,
            type: 'CHECK_IN',
            eventTitle: event.title,
            timestamp: now.toISOString(),
            status: 'CHECKED_IN',
            message: 'Entrada registrada com sucesso!',
          };
        }
        if (!previous?.checkInAt) {
          throw new BadRequestException({
            statusCode: 400,
            error: 'Bad Request',
            code: 'CHECK_IN_REQUIRED',
            message: 'Não é possível registrar saída sem entrada prévia',
          });
        }
        if (previous.checkOutAt)
          return this.duplicate('ALREADY_CHECKED_OUT', now);
        await tx.attendance.update({
          where,
          data: { checkOutAt: now, status: 'CONFIRMED' },
        });
        // CONFIRMED + Event.certificateEnabled habilita a elegibilidade persistida
        // para a #27. Emissão/PDF não são executados dentro desta transação.
        return {
          success: true,
          type: 'CHECK_OUT',
          eventTitle: event.title,
          timestamp: now.toISOString(),
          status: 'CONFIRMED',
          message: 'Presença confirmada com sucesso!',
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5000,
        timeout: 10000,
      },
    );
  }

  async findMine(user: TokenPayload): Promise<MyAttendanceView[]> {
    return this.prisma.$transaction(async (tx) => {
      const student = await this.activeStudent(tx, user);
      const rows = await tx.attendance.findMany({
        where: {
          studentRefRa: student.ra,
          studentRa: student.ra,
          studentAccountId: student.accountId,
        },
        select: attendanceSelect,
        orderBy: [{ checkInAt: 'desc' }, { id: 'asc' }],
      });
      return rows.map((row) => this.toView(row));
    });
  }

  async findByEvent(eventId: string): Promise<AttendanceView[]> {
    await this.requireEvent(eventId);
    const rows = await this.prisma.attendance.findMany({
      where: { eventId },
      select: {
        ...attendanceSelect,
        studentRa: true,
        studentName: true,
        studentCourse: true,
      },
      orderBy: [{ checkInAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      ...this.toView(row),
      studentRa: row.studentRa,
      studentName: row.studentName,
      studentCourse: row.studentCourse,
    }));
  }

  async summary(eventId: string): Promise<AttendanceSummary> {
    await this.requireEvent(eventId);
    // Uma única fotografia do banco para as três métricas.
    const [counts] = await this.prisma.$queryRaw<AttendanceSummary[]>`
      SELECT count(*) FILTER (WHERE "checkInAt" IS NOT NULL)::int AS "checkedInCount",
             count(*) FILTER (WHERE "checkOutAt" IS NOT NULL)::int AS "checkedOutCount",
             count(*) FILTER (WHERE "status" = 'CONFIRMED')::int AS "confirmedCount"
      FROM "Attendance" WHERE "eventId" = ${eventId}`;
    return counts;
  }

  private async activeStudent(
    tx: Prisma.TransactionClient,
    user: TokenPayload,
  ): Promise<ActiveStudent> {
    if (user.role !== 'student')
      throw new ForbiddenException('Apenas alunos podem registrar presença');
    if (typeof user.sub !== 'string' || !user.accountId)
      throw new UnauthorizedException('Identidade de aluno inválida');
    // FOR SHARE também impede exclusão/recriação ou inativação durante a operação.
    const [student] = await tx.$queryRaw<ActiveStudent[]>`
      SELECT "ra", "accountId", "name", "course", "status" FROM "Student" WHERE "ra" = ${user.sub} FOR SHARE`;
    if (
      !student ||
      student.accountId !== user.accountId ||
      !['ativo', 'em curso'].includes(student.status.trim().toLowerCase())
    ) {
      throw new UnauthorizedException(
        'Conta de aluno inativa ou identidade inválida',
      );
    }
    return student;
  }

  private async verifyQr(token: string): Promise<QrClaims> {
    let data: unknown;
    try {
      data = await this.jwt.verifyAsync<object>(token, {
        secret: this.qrSecret,
        algorithms: ['HS256'],
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'TokenExpiredError')
        this.expiredQr();
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'INVALID_QR_TOKEN',
        message: 'QR Code inválido',
      });
    }
    const qr = data as Partial<QrClaims> | null;
    if (
      !qr ||
      typeof qr !== 'object' ||
      typeof qr.eventId !== 'string' ||
      !isUUID(qr.eventId) ||
      !['CHECK_IN', 'CHECK_OUT'].includes(qr.checkpoint ?? '') ||
      !Number.isSafeInteger(qr.checkpointVersion) ||
      Number(qr.checkpointVersion) < 1 ||
      typeof qr.jti !== 'string' ||
      !isUUID(qr.jti) ||
      !Number.isSafeInteger(qr.iat) ||
      !Number.isSafeInteger(qr.exp) ||
      Number(qr.exp) <= Number(qr.iat) ||
      Number(qr.iat) > Math.floor(Date.now() / 1000)
    ) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'INVALID_QR_TOKEN',
        message: 'QR Code inválido',
      });
    }
    return qr as QrClaims;
  }

  private expiredQr(): never {
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      code: 'QR_EXPIRED',
      message: 'QR Code expirado',
    });
  }

  private duplicate(
    code: 'ALREADY_CHECKED_IN' | 'ALREADY_CHECKED_OUT',
    now: Date,
  ): AttendanceScanResponse {
    return {
      success: false,
      code,
      timestamp: now.toISOString(),
      message:
        code === 'ALREADY_CHECKED_IN'
          ? 'Entrada já registrada anteriormente'
          : 'Saída já registrada',
    };
  }

  private async requireEvent(id: string) {
    if (
      !(await this.prisma.event.findUnique({
        where: { id },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException('Evento não encontrado');
    }
  }

  private toView(
    row: Pick<
      Attendance,
      'id' | 'eventId' | 'checkInAt' | 'checkOutAt' | 'status'
    > & { event: { title: string } },
  ): MyAttendanceView {
    return {
      id: row.id,
      eventId: row.eventId,
      eventTitle: row.event.title,
      checkInAt: row.checkInAt?.toISOString() ?? null,
      checkOutAt: row.checkOutAt?.toISOString() ?? null,
      status: row.status,
    };
  }
}
