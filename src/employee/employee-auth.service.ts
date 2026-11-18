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
  consumeSqlRateLimit,
  hashRateLimitKey,
} from '../database/rate-limit.helper';
import { MailService } from '../mail/mail.service';
import { HashContentService } from '../utils/hashContentService';
import {
  EmployeeChangePasswordDto,
  EmployeeEmailRequestDto,
  EmployeeLoginDto,
  EmployeeTokenPasswordDto,
} from './dto/employee-access.dto';
import {
  normalizeEmail,
  normalizeOptionalCode,
  throwEmployeeError,
} from './employee.errors';
import { EmployeeService } from './employee.service';
import type { EmployeeEntity } from './entities/employee.entity';
import { EmployeeMapper } from './mapper/employee.mapper';
import { EmployeeRepository } from './repository/employee.repository';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const FIRST_ACCESS_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;
const JWT_THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function matchesRegistration(
  value: string,
  registrationNumber: string | null,
): boolean {
  return (
    registrationNumber !== null &&
    normalizeOptionalCode(value) === registrationNumber
  );
}

function assertPersonalPassword(
  value: string,
  registrationNumber: string | null,
): void {
  if (matchesRegistration(value, registrationNumber)) {
    throwEmployeeError(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_ERROR',
      'A senha pessoal precisa ser diferente da matrícula funcional.',
    );
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
    await this.enforcePublicEmailRateLimit(email, clientIp, 'login');
    const employee = await this.employeeRepository.findByEmail(email);
    if (
      employee?.accountStatus === 'ACTIVE' &&
      employee.archivedAt === null &&
      !employee.passwordHash &&
      matchesRegistration(dto.password, employee.registrationNumber)
    ) {
      return this.issueFirstAccess(employee);
    }
    const valid =
      employee?.accountStatus === 'ACTIVE' &&
      employee.archivedAt === null &&
      Boolean(employee.passwordHash) &&
      !matchesRegistration(dto.password, employee.registrationNumber) &&
      (await this.hashService.compareHash(
        employee.passwordHash!,
        dto.password,
      ));
    if (!valid) {
      throwEmployeeError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHORIZED',
        'E-mail ou senha inválidos.',
      );
    }

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
      scope === 'login' ? 50 : 20,
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
      scope === 'login' ? 10 : 3,
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

  private async issueFirstAccess(
    employee: EmployeeEntity,
  ): Promise<EmployeeLoginResponse> {
    const firstAccessToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + FIRST_ACCESS_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      const authorization = await tx.employeeAccessToken.create({
        data: {
          employeeId: employee.id,
          tokenHash: sha256Hex('first-login:' + firstAccessToken),
          purpose: 'ACTIVATE',
          authVersion: employee.authVersion,
          expiresAt,
          deliveryState: 'UNKNOWN',
        },
      });
      await tx.employeeAudit.create({
        data: {
          employeeId: employee.id,
          actorRole: 'employee',
          actorId: employee.id,
          action: 'FIRST_ACCESS_AUTHORIZED',
          changedFields: [],
          requestId: 'first-login-' + authorization.id,
        },
      });
    });
    return {
      profileType: 'employee',
      mustChangePassword: true,
      firstAccessToken,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async sendPasswordReset(employee: EmployeeEntity): Promise<void> {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);

    const tokenRecord = await this.prisma.employeeAccessToken.create({
      data: {
        employeeId: employee.id,
        tokenHash,
        purpose: 'RESET_PASSWORD',
        authVersion: employee.authVersion,
        expiresAt,
        deliveryState: 'PENDING',
      },
    });

    let deliveryState: 'ACCEPTED' | 'FAILED' = 'FAILED';
    try {
      const actionUrl = buildEmployeeActionUrl('RESET_PASSWORD', rawToken);
      await this.mailService.sendEmployeeAccessEmail({
        email: employee.email,
        recipientName: this.mapper.getDisplayName(employee),
        actionUrl,
        purpose: 'RESET_PASSWORD',
        expiresInMinutes: RESET_TTL_MS / 60_000,
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
        employeeId: employee.id,
        actorRole: 'system',
        actorId: 'public-forgot-password',
        action: 'PASSWORD_RESET_REQUESTED',
        requestId: `req-forgot-${randomBytes(8).toString('hex')}`,
        changedFields: {
          purpose: 'RESET_PASSWORD',
          deliveryState,
        },
      },
    });
  }

  requestAccess(): EmployeeGenericAcceptedResponse {
    throwEmployeeError(
      HttpStatus.GONE,
      'VALIDATION_ERROR',
      'Inicie o primeiro acesso na tela de login.',
    );
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
      await this.sendPasswordReset(employee);
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
    const tokenHash = sha256Hex(
      (purpose === 'ACTIVATE' ? 'first-login:' : '') + token.trim(),
    );
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
        (purpose === 'ACTIVATE'
          ? employee.passwordHash !== null
          : !employee.passwordHash)
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
      if (
        !current ||
        current.authVersion !== employee.authVersion ||
        current.archivedAt !== null ||
        current.accountStatus !== 'ACTIVE'
      ) {
        throwEmployeeError(
          HttpStatus.UNAUTHORIZED,
          'SESSION_REVOKED',
          'Sessão expirada.',
        );
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

  sendInvite(): EmployeeInviteResponse {
    throwEmployeeError(
      HttpStatus.GONE,
      'VALIDATION_ERROR',
      'Convites de primeiro acesso foram desativados.',
    );
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
      firstAccessMethod: employee.passwordHash
        ? null
        : employee.registrationNumber
          ? 'REGISTRATION'
          : 'REGISTRATION_REQUIRED',
      lastLoginAt: employee.lastLoginAt?.toISOString() ?? null,
      lastAccessRequestAt: latestToken?.createdAt.toISOString() ?? null,
      lastDeliveryState: latestToken?.deliveryState ?? null,
    };
  }
}
