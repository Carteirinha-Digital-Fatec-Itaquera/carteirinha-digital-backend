import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma, StudentOfflineReceipt } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TokenPayload } from '../auth/dto/payload.dto';
import { AttendanceService } from './attendance.service';
import { AttendanceQrReferenceService } from './attendance-qr-reference.service';
import {
  OfflineStatusDto,
  OfflineSubmitDto,
} from './dto/offline-attendance.dto';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
@Injectable()
export class OfflineAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
    private readonly refs: AttendanceQrReferenceService,
  ) {}

  async prepare(
    user: TokenPayload & { exp?: number },
    origin: string,
    previous?: string,
  ) {
    if (
      user.role !== 'student' ||
      typeof user.sub !== 'string' ||
      !user.accountId ||
      !Number.isSafeInteger(user.exp) ||
      user.exp! * 1000 <= Date.now()
    )
      throw new UnauthorizedException(
        'Login de aluno com validade obrigatória.',
      );
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Math.min(user.exp! * 1000, Date.now() + 86400000),
    );
    await this.prisma.$transaction(async (tx) => {
      await this.active(tx, user.sub as string, user.accountId!);
      if (previous)
        await tx.studentOfflineSession.updateMany({
          where: { tokenHash: hash(previous), revokedAt: null },
          data: { revokedAt: new Date() },
        });
      await tx.studentOfflineSession.create({
        data: {
          tokenHash: hash(token),
          studentRa: user.sub as string,
          accountId: user.accountId!,
          origin,
          expiresAt,
        },
      });
    });
    return {
      token,
      accountId: user.accountId,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async active(
    tx: Prisma.TransactionClient,
    ra: string,
    accountId: string,
  ) {
    const rows = await tx.$queryRaw<
      { accountId: string; status: string }[]
    >`SELECT "accountId", "status" FROM "Student" WHERE "ra" = ${ra} FOR SHARE`;
    if (
      rows[0]?.accountId !== accountId ||
      !['ativo', 'em curso'].includes(rows[0]?.status.trim().toLowerCase())
    )
      throw new UnauthorizedException({
        code: 'OFFLINE_SESSION_REQUIRED',
        message: 'Entre novamente com sua conta ativa.',
      });
  }

  private async session(
    tx: Prisma.TransactionClient,
    token: string | undefined,
    origin: string,
    accountId: string,
  ) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) this.unauthorized();
    // FOR SHARE serializes revocation with accepted operations without blocking other reads.
    const sessions = await tx.$queryRaw<
      {
        accountId: string;
        studentRa: string;
        origin: string;
        expiresAt: Date;
        revokedAt: Date | null;
      }[]
    >`SELECT * FROM "StudentOfflineSession" WHERE "tokenHash" = ${hash(token)} FOR SHARE`;
    const session = sessions[0];
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    )
      this.unauthorized();
    if (session.origin !== origin)
      throw new ForbiddenException({
        code: 'ORIGIN_MISMATCH',
        message: 'Origem inválida.',
      });
    if (session.accountId !== accountId)
      throw new ForbiddenException({
        code: 'ACCOUNT_MISMATCH',
        message: 'A tentativa pertence a outra conta.',
      });
    await this.active(tx, session.studentRa, session.accountId);
    if (session.expiresAt.getTime() <= Date.now()) this.unauthorized();
    return session;
  }
  private unauthorized(): never {
    throw new UnauthorizedException({
      code: 'OFFLINE_SESSION_REQUIRED',
      message: 'Volte ao aplicativo e entre novamente.',
    });
  }

  async submit(
    token: string | undefined,
    origin: string,
    dto: OfflineSubmitDto,
  ) {
    const requestHash = hash(
      JSON.stringify([
        dto.accountId,
        dto.reference,
        new Date(dto.scannedAt).toISOString(),
      ]),
    );
    return this.prisma.$transaction(
      async (tx) => {
        const session = await this.session(tx, token, origin, dto.accountId);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['offline', dto.accountId, dto.requestId])}, 0))::text`;
        if (session.expiresAt.getTime() <= Date.now()) this.unauthorized();
        const prior = await tx.studentOfflineReceipt.findUnique({
          where: {
            accountId_requestId: {
              accountId: dto.accountId,
              requestId: dto.requestId,
            },
          },
        });
        if (prior) {
          if (prior.requestHash !== requestHash)
            throw new ConflictException({
              code: 'REQUEST_ID_REUSED',
              message: 'Identificador já utilizado com outros dados.',
            });
          return this.view(prior);
        }
        const record = await this.refs.resolveReference(dto.reference);
        const result = await this.attendance.scan(
          record.jwtToken,
          {
            sub: session.studentRa,
            accountId: session.accountId,
            role: 'student',
          },
          undefined,
          undefined,
          tx,
          true,
        );
        if (session.expiresAt.getTime() <= Date.now()) this.unauthorized();
        if (record.expiresAt && record.expiresAt.getTime() <= Date.now())
          throw new ConflictException({
            code: 'EXPIRED_OR_INVALID_QR',
            message: 'QR Code expirado. Faça uma nova leitura.',
          });
        // Client time is declared evidence only. Server time still controls every acceptance rule.
        const receipt = await tx.studentOfflineReceipt.create({
          data: {
            accountId: dto.accountId,
            requestId: dto.requestId,
            requestHash,
            reference: dto.reference,
            scannedAt: new Date(dto.scannedAt),
            result: result as unknown as Prisma.InputJsonValue,
          },
        });
        return this.view(receipt);
      },
      { maxWait: 5000, timeout: 15000 },
    );
  }
  async status(
    token: string | undefined,
    origin: string,
    dto: OfflineStatusDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.session(tx, token, origin, dto.accountId);
      const receipts = await tx.studentOfflineReceipt.findMany({
        where: { accountId: dto.accountId, requestId: { in: dto.requestIds } },
      });
      const found = new Set(receipts.map((r) => r.requestId));
      return {
        receipts: receipts.map((r) => this.view(r)),
        missingRequestIds: dto.requestIds.filter((id) => !found.has(id)),
      };
    });
  }
  async revoke(token: string | undefined, origin: string) {
    if (token)
      await this.prisma.studentOfflineSession.updateMany({
        where: { tokenHash: hash(token), origin, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    return { revoked: true };
  }
  private view(row: StudentOfflineReceipt) {
    const result = row.result as Prisma.JsonObject;
    return {
      requestId: row.requestId,
      accountId: row.accountId,
      reference: row.reference,
      scannedAt: row.scannedAt.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
      status: 'confirmed' as const,
      message: result.message,
      result,
    };
  }
}
