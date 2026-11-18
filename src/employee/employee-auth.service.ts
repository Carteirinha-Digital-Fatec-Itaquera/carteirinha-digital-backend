import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type {
  EmployeeAccessStatusResponse,
  EmployeeActivateResponse,
  EmployeeChangePasswordResponse,
  EmployeeGenericAcceptedResponse,
  EmployeeInviteResponse,
  EmployeeLoginResponse,
  EmployeeResetPasswordResponse,
} from '../contracts/v1-employees.types';
import { buildEmployeeActionUrl } from '../auth/password-recovery-url';
import type { TokenPayload } from '../auth/dto/payload.dto';
import { PrismaService } from '../database/prisma.service';
import {
  checkSqlRateLimit,
  consumeSqlRateLimit,
  hashRateLimitKey,
  resetSqlRateLimit,
} from '../database/rate-limit.helper';
import { MailService } from '../mail/mail.service';
import { HashContentService } from '../utils/hashContentService';
import {
  EmployeeChangePasswordDto,
  EmployeeEmailRequestDto,
  EmployeeFirstAccessDto,
  EmployeeInviteDto,
  EmployeeLoginDto,
  EmployeeTokenPasswordDto,
} from './dto/employee-access.dto';
import { normalizeEmail, normalizeOptionalCode, throwEmployeeError } from './employee.errors';
import { EmployeeService } from './employee.service';
import type { EmployeeEntity } from './entities/employee.entity';
import { EmployeeMapper } from './mapper/employee.mapper';
import { EmployeeRepository } from './repository/employee.repository';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ACTIVATE_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;
const JWT_THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function matchesRegistration(value: string, registrationNumber: string | null): boolean {
  return registrationNumber !== null && normalizeOptionalCode(value) === registrationNumber;
}

function assertPersonalPassword(value: string, registrationNumber: string | null): void {
  if (matchesRegistration(value, registrationNumber)) {
    throwEmployeeError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR',
      'A senha pessoal precisa ser diferente da matrícula funcional.');
  }
}

@Injectable()
export class EmployeeAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeeRepository: EmployeeRepository,
    private readonly employeeService: EmployeeService,
    private readonly mapper: EmployeeMapper,
    private readonly jwtService: JwtService,
    private readonly hashService: HashContentService,
    private readonly mailService: MailService,
  ) {}

  async login(
    dto: EmployeeLoginDto,
    clientIp: string,
  ): Promise<EmployeeLoginResponse> {
    const email = normalizeEmail(dto.email);
    const rateKey = hashRateLimitKey('emp:login', `${clientIp}:${email}`);
    const check = await checkSqlRateLimit(this.prisma, rateKey, 10);
    if (!check.allowed) {
      throwEmployeeError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Muitas tentativas de login. Tente novamente mais tarde.',
      );
    }

    const employee = await this.employeeRepository.findByEmail(email);
    const valid = employee?.accountStatus === 'ACTIVE' && employee.archivedAt === null &&
      Boolean(employee.passwordHash) &&
      !matchesRegistration(dto.password, employee.registrationNumber) &&
      await this.hashService.compareHash(employee.passwordHash!, dto.password);
    if (!valid) {
      await consumeSqlRateLimit(this.prisma, rateKey, 10, FIFTEEN_MIN_MS);
      throwEmployeeError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHORIZED',
        'E-mail ou senha inválidos.',
      );
    }

    await resetSqlRateLimit(this.prisma, rateKey);
    await this.prisma.employee.update({
      where: { id: employee.id },
      data: { lastLoginAt: new Date() },
    });

    const payload: TokenPayload = {
      sub: employee.id,
      accountId: employee.accountId,
      role: 'employee',
      authVersion: employee.authVersion,
    };

    const token = await this.jwtService.signAsync(payload);
    return {
      token,
      mustChangePassword: false,
      profileType: 'employee',
      expiresAt: new Date(Date.now() + JWT_THIRTY_DAYS_MS).toISOString(),
    };
  }

  private async enforcePublicEmailRateLimit(
    email: string,
    clientIp: string,
    scope: string,
  ): Promise<void> {
    const ipKey = hashRateLimitKey(`emp:${scope}:ip`, clientIp);
    const ipLimit = await consumeSqlRateLimit(
      this.prisma,
      ipKey,
      20,
      FIFTEEN_MIN_MS,
    );
    if (!ipLimit.allowed) {
      throwEmployeeError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Limite de solicitações excedido. Tente novamente mais tarde.',
      );
    }

    const emailKey = hashRateLimitKey(`emp:${scope}:email`, email);
    const emailLimit = await consumeSqlRateLimit(
      this.prisma,
      emailKey,
      3,
      FIFTEEN_MIN_MS,
    );
    if (!emailLimit.allowed) {
      throwEmployeeError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Limite de solicitações para este e-mail excedido. Tente novamente mais tarde.',
      );
    }
  }

  private async createAndSendActionToken(params: {
    employee: EmployeeEntity;
    purpose: 'ACTIVATE' | 'RESET_PASSWORD';
    ttlMs: number;
    actorRole: 'employee' | 'secretary' | 'system';
    actorId: string;
    requestId: string;
  }): Promise<'ACCEPTED' | 'FAILED'> {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + params.ttlMs);

    const tokenRecord = await this.prisma.employeeAccessToken.create({
      data: {
        employeeId: params.employee.id,
        tokenHash,
        purpose: params.purpose,
        authVersion: params.employee.authVersion,
        expiresAt,
        deliveryState: 'PENDING',
      },
    });

    let deliveryState: 'ACCEPTED' | 'FAILED' = 'FAILED';
    try {
      const actionUrl = buildEmployeeActionUrl(params.purpose, rawToken);
      await this.mailService.sendEmployeeAccessEmail({
        email: params.employee.email,
        recipientName: this.mapper.getDisplayName(params.employee),
        actionUrl,
        purpose: params.purpose,
        expiresInMinutes: params.ttlMs / 60_000,
      });
      deliveryState = 'ACCEPTED';
    } catch {
      deliveryState = 'FAILED';
    }

    await this.prisma.employeeAccessToken.update({
      where: { id: tokenRecord.id },
      data: { deliveryState },
    });

    await this.prisma.employeeAudit.create({
      data: {
        employeeId: params.employee.id,
        actorRole: params.actorRole,
        actorId: params.actorId,
        action:
          params.purpose === 'ACTIVATE'
            ? 'ACCESS_ACTIVATION_REQUESTED'
            : 'PASSWORD_RESET_REQUESTED',
        requestId: params.requestId,
        changedFields: {
          purpose: params.purpose,
          deliveryState,
        },
      },
    });

    return deliveryState;
  }

  async requestAccess(
    dto: EmployeeFirstAccessDto,
    clientIp: string,
  ): Promise<EmployeeGenericAcceptedResponse> {
    const email = normalizeEmail(dto.email);
    await this.enforcePublicEmailRateLimit(email, clientIp, 'activate');

    const employee = await this.employeeRepository.findByEmail(email);
    if (
      employee &&
      employee.accountStatus === 'ACTIVE' &&
      employee.archivedAt === null &&
      !employee.passwordHash &&
      (employee.registrationNumber
        ? dto.registrationNumber !== undefined && matchesRegistration(dto.registrationNumber, employee.registrationNumber)
        : dto.registrationNumber === undefined)
    ) {
      await this.createAndSendActionToken({
        employee,
        purpose: 'ACTIVATE',
        ttlMs: employee.registrationNumber ? RESET_TTL_MS : ACTIVATE_TTL_MS,
        actorRole: 'system',
        actorId: 'public-request-access',
        requestId: `req-access-${randomBytes(8).toString('hex')}`,
      });
    }

    return {
      accepted: true,
      message:
        'Se o e-mail estiver apto para ativação, enviaremos as instruções de primeiro acesso.',
    };
  }

  async forgotPassword(
    dto: EmployeeEmailRequestDto,
    clientIp: string,
  ): Promise<EmployeeGenericAcceptedResponse> {
    const email = normalizeEmail(dto.email);
    await this.enforcePublicEmailRateLimit(email, clientIp, 'forgot');

    const employee = await this.employeeRepository.findByEmail(email);
    if (
      employee &&
      employee.accountStatus === 'ACTIVE' &&
      employee.archivedAt === null &&
      employee.passwordHash
    ) {
      await this.createAndSendActionToken({
        employee,
        purpose: 'RESET_PASSWORD',
        ttlMs: RESET_TTL_MS,
        actorRole: 'system',
        actorId: 'public-forgot-password',
        requestId: `req-forgot-${randomBytes(8).toString('hex')}`,
      });
    }

    return {
      accepted: true,
      message:
        'Se o e-mail estiver cadastrado e ativo, enviaremos as instruções de redefinição.',
    };
  }

  private async consumeActionTokenAndSetPassword(
    token: string,
    newPassword: string,
    purpose: 'ACTIVATE' | 'RESET_PASSWORD',
  ): Promise<void> {
    const tokenHash = sha256Hex(token.trim());
    const now = new Date();
    const passwordHash = await this.hashService.hashContent(newPassword);

    await this.prisma.$transaction(async (tx) => {
      const tokenRecord = await tx.employeeAccessToken.findUnique({
        where: { tokenHash },
      });

      if (
        !tokenRecord ||
        tokenRecord.purpose !== purpose ||
        tokenRecord.usedAt !== null ||
        tokenRecord.expiresAt.getTime() <= now.getTime()
      ) {
        throwEmployeeError(
          HttpStatus.BAD_REQUEST,
          'TOKEN_INVALID_OR_EXPIRED',
          'Token inválido ou expirado.',
        );
      }

      await this.employeeService.lockEmployeeRow(tx, tokenRecord.employeeId);

      const employee = await tx.employee.findUnique({
        where: { id: tokenRecord.employeeId },
      });

      if (
        !employee ||
        employee.archivedAt !== null ||
        employee.accountStatus !== 'ACTIVE' ||
        employee.authVersion !== tokenRecord.authVersion ||
        (purpose === 'ACTIVATE' ? employee.passwordHash !== null : !employee.passwordHash)
      ) {
        throwEmployeeError(
          HttpStatus.BAD_REQUEST,
          'TOKEN_INVALID_OR_EXPIRED',
          'Token inválido ou conta indisponível.',
        );
      }

      assertPersonalPassword(newPassword, employee.registrationNumber);

      const consumed = await tx.employeeAccessToken.updateMany({
        where: {
          id: tokenRecord.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      if (consumed.count !== 1) {
        throwEmployeeError(
          HttpStatus.BAD_REQUEST,
          'TOKEN_INVALID_OR_EXPIRED',
          'Token já utilizado ou expirado.',
        );
      }

      await tx.employee.update({
        where: { id: employee.id },
        data: {
          passwordHash,
          authVersion: { increment: 1 },
          version: { increment: 1 },
        },
      });

      await tx.employeeAudit.create({
        data: {
          employeeId: employee.id,
          actorRole: 'employee',
          actorId: employee.id,
          action:
            purpose === 'ACTIVATE' ? 'ACCOUNT_ACTIVATED' : 'PASSWORD_RESET',
          requestId: `token-${tokenRecord.id}`,
          changedFields: { passwordUpdated: true },
        },
      });
    });
  }

  async activate(
    dto: EmployeeTokenPasswordDto,
  ): Promise<EmployeeActivateResponse> {
    await this.consumeActionTokenAndSetPassword(
      dto.token,
      dto.newPassword,
      'ACTIVATE',
    );
    return { activated: true };
  }

  async resetPassword(
    dto: EmployeeTokenPasswordDto,
  ): Promise<EmployeeResetPasswordResponse> {
    await this.consumeActionTokenAndSetPassword(
      dto.token,
      dto.newPassword,
      'RESET_PASSWORD',
    );
    return { reset: true };
  }

  async changePassword(
    employee: EmployeeEntity,
    dto: EmployeeChangePasswordDto,
  ): Promise<EmployeeChangePasswordResponse> {
    if (!employee.passwordHash) {
      throwEmployeeError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHORIZED',
        'Senha atual não definida.',
      );
    }

    const matches = await this.hashService.compareHash(
      employee.passwordHash,
      dto.currentPassword,
    );
    if (!matches) {
      throwEmployeeError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHORIZED',
        'Senha atual incorreta.',
      );
    }

    const newHash = await this.hashService.hashContent(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      await this.employeeService.lockEmployeeRow(tx, employee.id);
      const current = await this.employeeRepository.findById(employee.id, tx);
      if (!current || current.authVersion !== employee.authVersion ||
        current.archivedAt !== null || current.accountStatus !== 'ACTIVE') {
        throwEmployeeError(HttpStatus.UNAUTHORIZED, 'SESSION_REVOKED', 'Sessão expirada.');
      }
      assertPersonalPassword(dto.newPassword, current.registrationNumber);
      await tx.employee.update({
        where: { id: employee.id },
        data: {
          passwordHash: newHash,
          authVersion: { increment: 1 },
          version: { increment: 1 },
        },
      });

      await tx.employeeAudit.create({
        data: {
          employeeId: employee.id,
          actorRole: 'employee',
          actorId: employee.id,
          action: 'PASSWORD_CHANGED',
          requestId: `pwd-change-${employee.id}-${Date.now()}`,
          changedFields: { passwordUpdated: true },
        },
      });
    });

    return { changed: true, reauthenticate: true };
  }

  async sendInvite(
    employeeId: string,
    dto: EmployeeInviteDto,
    secretaryId: number,
  ): Promise<EmployeeInviteResponse> {
    const employee = await this.prisma.$transaction(async (tx) => {
      await this.employeeService.lockEmployeeRow(tx, employeeId);
      const current = await this.employeeRepository.findById(employeeId, tx);
      if (!current) {
        throwEmployeeError(
          HttpStatus.NOT_FOUND,
          'EMPLOYEE_NOT_FOUND',
          'Funcionário não encontrado.',
        );
      }
      if (current.version !== dto.expectedVersion) {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'O cadastro foi atualizado por outra operação.',
          { currentVersion: current.version },
        );
      }
      if (current.archivedAt !== null || current.accountStatus !== 'ACTIVE') {
        throwEmployeeError(
          HttpStatus.FORBIDDEN,
          'ACCOUNT_BLOCKED',
          'Não é possível enviar convite para conta bloqueada ou arquivada.',
        );
      }
      return current;
    });

    const deliveryState = await this.createAndSendActionToken({
      employee,
      purpose: 'ACTIVATE',
      ttlMs: ACTIVATE_TTL_MS,
      actorRole: 'secretary',
      actorId: String(secretaryId),
      requestId: dto.requestId,
    });

    return {
      requested: true,
      deliveryState,
      requestedAt: new Date().toISOString(),
    };
  }

  async getAccessStatus(
    employeeId: string,
  ): Promise<EmployeeAccessStatusResponse> {
    const employee = await this.employeeRepository.findById(employeeId);
    if (!employee) {
      throwEmployeeError(
        HttpStatus.NOT_FOUND,
        'EMPLOYEE_NOT_FOUND',
        'Funcionário não encontrado.',
      );
    }

    const latestToken = await this.prisma.employeeAccessToken.findFirst({
      where: { employeeId },
      orderBy: [{ createdAt: 'desc' }],
    });

    return {
      passwordDefined: Boolean(employee.passwordHash),
      firstAccessMethod: employee.passwordHash ? null : employee.registrationNumber ? 'REGISTRATION_EMAIL' : 'EMAIL_ONLY',
      lastLoginAt: employee.lastLoginAt?.toISOString() ?? null,
      lastAccessRequestAt: latestToken?.createdAt.toISOString() ?? null,
      lastDeliveryState: latestToken?.deliveryState ?? null,
    };
  }
}
