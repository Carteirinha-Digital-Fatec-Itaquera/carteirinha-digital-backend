import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Employee, EmployeeOfflineReceipt, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import type { TokenPayload } from '../auth/dto/payload.dto';
import { PrismaService } from '../database/prisma.service';
import { AttendanceQrReferenceService } from './attendance-qr-reference.service';
import { AttendanceService } from './attendance.service';
import {
  OfflineStatusDto,
  OfflineSubmitDto,
} from './dto/offline-attendance.dto';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class EmployeeOfflineAttendanceService {
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
      user.role !== 'employee' ||
      typeof user.sub !== 'string' ||
      !user.accountId ||
      typeof user.authVersion !== 'number' ||
      !Number.isSafeInteger(user.exp) ||
      user.exp! * 1000 <= Date.now()
    ) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Login de funcionário com validade obrigatória.',
      });
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Math.min(user.exp! * 1000, Date.now() + 86_400_000),
    );

    await this.prisma.$transaction(async (tx) => {
      await this.activeEmployee(
        tx,
        user.accountId!,
        user.authVersion as number,
      );
      if (previous) {
        await tx.employeeOfflineSession.updateMany({
          where: { tokenHash: hash(previous), revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await tx.employeeOfflineSession.create({
        data: {
          tokenHash: hash(token),
          accountId: user.accountId!,
          origin,
          authVersion: user.authVersion as number,
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

  private async activeEmployee(
    tx: Prisma.TransactionClient,
    accountId: string,
    authVersion: number,
  ): Promise<Employee> {
    const rows = await tx.$queryRaw<Employee[]>`
      SELECT * FROM "Employee" WHERE "accountId" = ${accountId} FOR SHARE`;
    const employee = rows[0];
    if (
      !employee ||
      employee.archivedAt !== null ||
      employee.accountStatus !== 'ACTIVE' ||
      employee.authVersion !== authVersion
    ) {
      throw new UnauthorizedException({
        code: 'OFFLINE_SESSION_REQUIRED',
        message: 'Conta bloqueada ou sessão revogada. Entre novamente.',
      });
    }
    return employee;
  }

  private async session(
    tx: Prisma.TransactionClient,
    token: string | undefined,
    origin: string,
    accountId: string,
  ) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) this.unauthorized();
    const sessions = await tx.$queryRaw<
      {
        accountId: string;
        origin: string;
        authVersion: number;
        expiresAt: Date;
        revokedAt: Date | null;
      }[]
    >`SELECT * FROM "EmployeeOfflineSession" WHERE "tokenHash" = ${hash(token)} FOR SHARE`;

    const session = sessions[0];
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      this.unauthorized();
    }
    if (session.origin !== origin) {
      throw new ForbiddenException({
        code: 'ORIGIN_MISMATCH',
        message: 'Origem inválida.',
      });
    }
    if (session.accountId !== accountId) {
      throw new ForbiddenException({
        code: 'ACCOUNT_MISMATCH',
        message: 'A tentativa pertence a outra conta.',
      });
    }
    const employee = await this.activeEmployee(
      tx,
      session.accountId,
      session.authVersion,
    );
    if (session.expiresAt.getTime() <= Date.now()) this.unauthorized();
    return { session, employee };
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
        const { session, employee } = await this.session(
          tx,
          token,
          origin,
          dto.accountId,
        );
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['employee-offline', dto.accountId, dto.requestId])}, 0))::text`;
        if (session.expiresAt.getTime() <= Date.now()) this.unauthorized();

        // Check existing receipt BEFORE revalidating QR/window
        const prior = await tx.employeeOfflineReceipt.findUnique({
          where: {
            accountId_requestId: {
              accountId: dto.accountId,
              requestId: dto.requestId,
            },
          },
        });
        if (prior) {
          if (prior.requestHash !== requestHash) {
            throw new ConflictException({
              code: 'REQUEST_ID_REUSED',
              message: 'Identificador já utilizado com outros dados.',
            });
          }
          return this.view(prior);
        }

        const record = await this.refs.resolveReference(dto.reference, tx);
        const result = await this.attendance.scan(
          record.jwtToken,
          {
            sub: employee.id,
            accountId: session.accountId,
            role: 'employee',
            authVersion: session.authVersion,
          },
          undefined,
          undefined,
          tx,
          true,
        );

        if (session.expiresAt.getTime() <= Date.now()) this.unauthorized();
        if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
          throw new ConflictException({
            code: 'EXPIRED_OR_INVALID_QR',
            message: 'QR Code expirado. Faça uma nova leitura.',
          });
        }

        const receipt = await tx.employeeOfflineReceipt.create({
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
      const receipts = await tx.employeeOfflineReceipt.findMany({
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
    if (token) {
      await this.prisma.employeeOfflineSession.updateMany({
        where: { tokenHash: hash(token), origin, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { revoked: true };
  }

  private view(row: EmployeeOfflineReceipt) {
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
