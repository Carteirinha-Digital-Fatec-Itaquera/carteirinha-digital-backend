import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  EmployeeAssignmentMutationResponse,
  EmployeeAssignmentView,
  EmployeeAuditItemView,
  EmployeeCredentialCardView,
  EmployeeHistoryView,
  EmployeeListItemView,
  EmployeeProfileView,
  PaginatedListResponse,
  RenewEmployeeQrResponse,
} from '../contracts/v1-employees.types';
import {
  CreateAssignmentDto,
  UpdateAssignmentDto,
} from './dto/employee-assignment.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import {
  EmployeeReasonMutationDto,
  RenewEmployeeQrDto,
  UpdateEmployeeStatusDto,
} from './dto/employee-mutation.dto';
import { EmployeeQueryDto } from './dto/employee-query.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import {
  buildEmployeeSearchText,
  EmployeeEligibilityService,
} from './employee-eligibility.service';
import {
  assertValidDateRange,
  generateOpaqueQrToken,
  hashPayload,
  normalizeDisplayText,
  normalizeEmail,
  normalizeOptionalCode,
  normalizeOptionalText,
  parseIsoDateOnly,
  throwEmployeeError,
} from './employee.errors';
import { EmployeeMapper } from './mapper/employee.mapper';
import { EmployeeRepository } from './repository/employee.repository';

@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: EmployeeRepository,
    private readonly mapper: EmployeeMapper,
    private readonly eligibility: EmployeeEligibilityService,
  ) {}

  private getEmployeeAppBaseUrl(): string {
    return process.env.EMPLOYEE_APP_URL?.trim().replace(/\/+$/, '') || '';
  }

  buildVerificationUrl(qrcode: string): string {
    const base = this.getEmployeeAppBaseUrl();
    const path = `/funcionarios/verificar/${encodeURIComponent(qrcode)}`;
    return base ? `${base}${path}` : path;
  }

  async lockEmployeeRow(
    tx: Prisma.TransactionClient,
    employeeId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Employee" WHERE "id" = ${employeeId} FOR UPDATE
    `;
    if (rows.length === 0) {
      throwEmployeeError(
        HttpStatus.NOT_FOUND,
        'EMPLOYEE_NOT_FOUND',
        'Funcionário não encontrado.',
      );
    }
  }

  async list(
    query: EmployeeQueryDto,
  ): Promise<PaginatedListResponse<EmployeeListItemView>> {
    const limit = query.limit ?? 25;
    const { items, total } = await this.repository.list({
      q: query.q,
      accountStatus: query.accountStatus,
      hasRegistration: query.hasRegistration,
      includeArchived: query.includeArchived,
      cursor: query.cursor,
      limit,
    });

    const mapped = items.map((item) => this.mapper.toListItemView(item));
    const filtered =
      query.credentialStatus === 'VALID'
        ? mapped.filter((item) => item.credential.valid)
        : query.credentialStatus === 'INVALID'
          ? mapped.filter((item) => !item.credential.valid)
          : mapped;

    const hasMore = filtered.length > limit;
    const pageItems = hasMore ? filtered.slice(0, limit) : filtered;
    const nextCursor = hasMore ? pageItems[pageItems.length - 1].id : null;

    return {
      items: pageItems,
      nextCursor,
      total,
    };
  }

  async getById(id: string): Promise<EmployeeProfileView> {
    const employee = await this.repository.findById(id);
    if (!employee) {
      throwEmployeeError(
        HttpStatus.NOT_FOUND,
        'EMPLOYEE_NOT_FOUND',
        'Funcionário não encontrado.',
      );
    }
    return this.mapper.toProfileView(employee, { includeRg: true });
  }

  async getMe(employeeId: string): Promise<EmployeeProfileView> {
    return this.getById(employeeId);
  }

  async getMyCredentialCard(
    employeeId: string,
  ): Promise<EmployeeCredentialCardView> {
    const employee = await this.repository.findById(employeeId);
    if (!employee) {
      throwEmployeeError(
        HttpStatus.NOT_FOUND,
        'EMPLOYEE_NOT_FOUND',
        'Funcionário não encontrado.',
      );
    }

    const evaluation = this.eligibility.evaluate(
      employee,
      employee.assignments ?? [],
      employee.photos ?? [],
    );

    return {
      id: employee.id,
      accountId: employee.accountId,
      profileType: 'EMPLOYEE',
      institutionName: 'Fatec Itaquera',
      displayName: this.mapper.getDisplayName(employee),
      registrationNumber: employee.registrationNumber ?? null,
      admissionDate: employee.admissionDate.toISOString().slice(0, 10),
      activeAssignments: evaluation.activeAssignments,
      credential: {
        valid: evaluation.valid,
        validityKind: evaluation.validityKind,
        validUntil: evaluation.validUntil,
        reasonCode: evaluation.reasonCode,
        checkedAt: evaluation.checkedAt,
      },
      approvedPhotoId: evaluation.approvedPhotoId,
      approvedPhotoUrl: evaluation.approvedPhotoId
        ? `/funcionarios/me/fotos/${evaluation.approvedPhotoId}/conteudo`
        : null,
      verificationUrl: this.buildVerificationUrl(employee.qrcode),
      qrcode: employee.qrcode,
      checkedAt: evaluation.checkedAt,
    };
  }

  async create(
    dto: CreateEmployeeDto,
    secretaryId: number,
  ): Promise<EmployeeProfileView> {
    const name = normalizeDisplayText(dto.name);
    const socialName = normalizeOptionalText(dto.socialName);
    const email = normalizeEmail(dto.email);
    const registrationNumber = normalizeOptionalCode(dto.registrationNumber);
    if (!registrationNumber) {
      throwEmployeeError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Informe a matrícula funcional.', {
        fieldErrors: { registrationNumber: ['A matrícula funcional é obrigatória.'] },
      });
    }
    const rg = normalizeOptionalCode(dto.rg);
    const admissionDate = parseIsoDateOnly(dto.admissionDate, 'admissionDate');

    const parsedAssignments = dto.assignments.map((a) => {
      const startsOn = a.startsOn
        ? parseIsoDateOnly(a.startsOn, 'startsOn')
        : null;
      const validUntil = a.validUntil
        ? parseIsoDateOnly(a.validUntil, 'validUntil')
        : null;
      assertValidDateRange(startsOn, validUntil);
      return {
        title: normalizeDisplayText(a.title),
        startsOn,
        validUntil,
        active: a.active ?? true,
      };
    });

    const requestHash = hashPayload({
      name,
      socialName,
      email,
      registrationNumber,
      hasRg: Boolean(rg),
      admissionDate: dto.admissionDate,
      assignments: parsedAssignments.map((a) => ({
        title: a.title,
        startsOn: a.startsOn?.toISOString().slice(0, 10) ?? null,
        validUntil: a.validUntil?.toISOString().slice(0, 10) ?? null,
        active: a.active,
      })),
    });

    return this.prisma.$transaction(async (tx) => {
      const existingAudit = await tx.employeeAudit.findFirst({
        where: {
          action: 'EMPLOYEE_CREATED',
          requestId: dto.requestId,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existingAudit) {
        const storedHash = (
          existingAudit.changedFields as Record<string, unknown> | null
        )?.requestHash;
        if (storedHash !== requestHash) {
          throwEmployeeError(
            HttpStatus.CONFLICT,
            'REQUEST_ID_REUSED',
            'requestId já utilizado com conteúdo diferente.',
            { requestId: dto.requestId },
          );
        }
        if (existingAudit.employeeId) {
          const existing = await this.repository.findById(
            existingAudit.employeeId,
            tx,
          );
          if (existing) {
            return this.mapper.toProfileView(existing, { includeRg: true });
          }
        }
      }

      const byEmail = await this.repository.findByEmail(email, tx);
      if (byEmail) {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'EMAIL_ALREADY_EXISTS',
          'Já existe um funcionário cadastrado com este e-mail.',
          { fieldErrors: { email: ['E-mail já cadastrado'] } },
        );
      }

      if (registrationNumber) {
        const byReg = await this.repository.findByRegistrationNumber(
          registrationNumber,
          tx,
        );
        if (byReg) {
          throwEmployeeError(
            HttpStatus.CONFLICT,
            'REGISTRATION_ALREADY_EXISTS',
            'Já existe um funcionário cadastrado com esta matrícula funcional.',
            {
              fieldErrors: { registrationNumber: ['Matrícula já cadastrada'] },
            },
          );
        }
      }

      const created = await this.repository.createAggregate(
        {
          name,
          socialName,
          searchText: buildEmployeeSearchText({
            name,
            socialName,
            registrationNumber,
          }),
          email,
          registrationNumber,
          rg,
          admissionDate,
          qrcode: generateOpaqueQrToken(),
          assignments: parsedAssignments,
        },
        tx,
      );

      await tx.employeeAudit.create({
        data: {
          employeeId: created.id,
          actorRole: 'secretary',
          actorId: String(secretaryId),
          action: 'EMPLOYEE_CREATED',
          requestId: dto.requestId,
          reason: 'Cadastro administrativo',
          changedFields: {
            requestHash,
            email,
            hasRegistrationNumber: true,
            hasRg: Boolean(rg),
            assignmentsCount: parsedAssignments.length,
          },
        },
      });

      return this.mapper.toProfileView(created, { includeRg: true });
    });
  }

  async update(
    id: string,
    dto: UpdateEmployeeDto,
    secretaryId: number,
  ): Promise<EmployeeProfileView> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockEmployeeRow(tx, id);
      const current = await this.repository.findById(id, tx);
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
          'O cadastro foi atualizado por outra operação. Recarregue os dados.',
          { currentVersion: current.version },
        );
      }

      const nextName =
        dto.name !== undefined ? normalizeDisplayText(dto.name) : current.name;
      const nextSocialName =
        dto.socialName !== undefined
          ? normalizeOptionalText(dto.socialName)
          : current.socialName;
      const nextEmail =
        dto.email !== undefined ? normalizeEmail(dto.email) : current.email;
      const nextRegistration =
        dto.registrationNumber !== undefined
          ? normalizeOptionalCode(dto.registrationNumber)
          : current.registrationNumber;
      const nextRg =
        dto.rg !== undefined ? normalizeOptionalCode(dto.rg) : current.rg;
      const nextAdmission =
        dto.admissionDate !== undefined
          ? parseIsoDateOnly(dto.admissionDate, 'admissionDate')
          : current.admissionDate;

      if (nextEmail !== current.email) {
        const emailConflict = await this.repository.findByEmail(nextEmail, tx);
        if (emailConflict && emailConflict.id !== id) {
          throwEmployeeError(
            HttpStatus.CONFLICT,
            'EMAIL_ALREADY_EXISTS',
            'Já existe um funcionário cadastrado com este e-mail.',
            { fieldErrors: { email: ['E-mail já cadastrado'] } },
          );
        }
      }

      if (nextRegistration && nextRegistration !== current.registrationNumber) {
        const regConflict = await this.repository.findByRegistrationNumber(
          nextRegistration,
          tx,
        );
        if (regConflict && regConflict.id !== id) {
          throwEmployeeError(
            HttpStatus.CONFLICT,
            'REGISTRATION_ALREADY_EXISTS',
            'Já existe um funcionário cadastrado com esta matrícula funcional.',
            {
              fieldErrors: { registrationNumber: ['Matrícula já cadastrada'] },
            },
          );
        }
      }

      const emailChanged = nextEmail !== current.email;
      const updated = await this.repository.updateAggregate(
        id,
        dto.expectedVersion,
        {
          name: nextName,
          socialName: nextSocialName,
          searchText: buildEmployeeSearchText({
            name: nextName,
            socialName: nextSocialName,
            registrationNumber: nextRegistration,
          }),
          email: nextEmail,
          registrationNumber: nextRegistration,
          rg: nextRg,
          admissionDate: nextAdmission,
          ...(emailChanged || nextRegistration !== current.registrationNumber
            ? { authVersion: current.authVersion + 1 } : {}),
        },
        tx,
      );

      if (!updated) {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'Conflito de versão ao atualizar funcionário.',
        );
      }

      const changedFields: Record<string, unknown> = {};
      if (nextName !== current.name) changedFields.name = true;
      if (nextSocialName !== current.socialName)
        changedFields.socialName = true;
      if (emailChanged) changedFields.email = nextEmail;
      if (nextRegistration !== current.registrationNumber)
        changedFields.registrationNumber = { changed: true };
      if (nextRg !== current.rg) changedFields.rg = { changed: true };
      if (
        nextAdmission.toISOString().slice(0, 10) !==
        current.admissionDate.toISOString().slice(0, 10)
      ) {
        changedFields.admissionDate = nextAdmission.toISOString().slice(0, 10);
      }

      await tx.employeeAudit.create({
        data: {
          employeeId: id,
          actorRole: 'secretary',
          actorId: String(secretaryId),
          action: 'EMPLOYEE_UPDATED',
          requestId: `patch-${id}-${updated.version}`,
          reason: normalizeDisplayText(dto.reason),
          changedFields: changedFields as Prisma.InputJsonValue,
        },
      });

      return this.mapper.toProfileView(updated, { includeRg: true });
    });
  }

  async updateStatus(
    id: string,
    dto: UpdateEmployeeStatusDto,
    secretaryId: number,
  ): Promise<EmployeeProfileView> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockEmployeeRow(tx, id);
      const current = await this.repository.findById(id, tx);
      if (!current) {
        throwEmployeeError(
          HttpStatus.NOT_FOUND,
          'EMPLOYEE_NOT_FOUND',
          'Funcionário não encontrado.',
        );
      }
      if (current.archivedAt || current.accountStatus === 'ARCHIVED') {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'Funcionário arquivado deve ser restaurado antes de alterar o status.',
          { currentVersion: current.version },
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

      const authVersionBump =
        dto.status === 'BLOCKED'
          ? current.authVersion + 1
          : current.authVersion;

      const updated = await this.repository.updateAggregate(
        id,
        dto.expectedVersion,
        {
          accountStatus: dto.status,
          authVersion: authVersionBump,
        },
        tx,
      );
      if (!updated) {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'Conflito de versão ao alterar status.',
        );
      }

      await tx.employeeAudit.create({
        data: {
          employeeId: id,
          actorRole: 'secretary',
          actorId: String(secretaryId),
          action:
            dto.status === 'BLOCKED'
              ? 'EMPLOYEE_BLOCKED'
              : 'EMPLOYEE_ACTIVATED',
          requestId: `status-${id}-${updated.version}`,
          reason: normalizeDisplayText(dto.reason),
          changedFields: {
            fromStatus: current.accountStatus,
            toStatus: dto.status,
          },
        },
      });

      return this.mapper.toProfileView(updated, { includeRg: true });
    });
  }

  async archive(
    id: string,
    dto: EmployeeReasonMutationDto,
    secretaryId: number,
  ): Promise<EmployeeProfileView> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockEmployeeRow(tx, id);
      const current = await this.repository.findById(id, tx);
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

      const now = new Date();
      const updated = await this.repository.updateAggregate(
        id,
        dto.expectedVersion,
        {
          accountStatus: 'ARCHIVED',
          archivedAt: now,
          authVersion: current.authVersion + 1,
        },
        tx,
      );
      if (!updated) {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'Conflito de versão ao arquivar funcionário.',
        );
      }

      await tx.employeeAudit.create({
        data: {
          employeeId: id,
          actorRole: 'secretary',
          actorId: String(secretaryId),
          action: 'EMPLOYEE_ARCHIVED',
          requestId: `archive-${id}-${updated.version}`,
          reason: normalizeDisplayText(dto.reason),
          changedFields: { archivedAt: now.toISOString() },
        },
      });

      return this.mapper.toProfileView(updated, { includeRg: true });
    });
  }

  async restore(
    id: string,
    dto: EmployeeReasonMutationDto,
    secretaryId: number,
  ): Promise<EmployeeProfileView> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockEmployeeRow(tx, id);
      const current = await this.repository.findById(id, tx);
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

      const updated = await this.repository.updateAggregate(
        id,
        dto.expectedVersion,
        {
          accountStatus: 'ACTIVE',
          archivedAt: null,
        },
        tx,
      );
      if (!updated) {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'Conflito de versão ao restaurar funcionário.',
        );
      }

      await tx.employeeAudit.create({
        data: {
          employeeId: id,
          actorRole: 'secretary',
          actorId: String(secretaryId),
          action: 'EMPLOYEE_RESTORED',
          requestId: `restore-${id}-${updated.version}`,
          reason: normalizeDisplayText(dto.reason),
          changedFields: { accountStatus: 'ACTIVE' },
        },
      });

      return this.mapper.toProfileView(updated, { includeRg: true });
    });
  }

  async renewQr(
    id: string,
    dto: RenewEmployeeQrDto,
    secretaryId: number,
  ): Promise<RenewEmployeeQrResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockEmployeeRow(tx, id);
      const current = await this.repository.findById(id, tx);
      if (!current) {
        throwEmployeeError(
          HttpStatus.NOT_FOUND,
          'EMPLOYEE_NOT_FOUND',
          'Funcionário não encontrado.',
        );
      }

      const existingAudit = await tx.employeeAudit.findFirst({
        where: {
          employeeId: id,
          action: 'QR_RENEWED',
          requestId: dto.requestId,
        },
      });
      if (existingAudit) {
        return {
          id: current.id,
          version: current.version,
          qrcode: current.qrcode,
          verificationUrl: this.buildVerificationUrl(current.qrcode),
        };
      }

      if (current.version !== dto.expectedVersion) {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'O cadastro foi atualizado por outra operação.',
          { currentVersion: current.version },
        );
      }

      const nextQr = generateOpaqueQrToken();
      const updated = await this.repository.updateAggregate(
        id,
        dto.expectedVersion,
        { qrcode: nextQr },
        tx,
      );
      if (!updated) {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'Conflito de versão ao renovar QR.',
        );
      }

      await tx.employeeAudit.create({
        data: {
          employeeId: id,
          actorRole: 'secretary',
          actorId: String(secretaryId),
          action: 'QR_RENEWED',
          requestId: dto.requestId,
          reason: normalizeDisplayText(dto.reason),
          changedFields: { qrRotated: true },
        },
      });

      return {
        id: updated.id,
        version: updated.version,
        qrcode: updated.qrcode,
        verificationUrl: this.buildVerificationUrl(updated.qrcode),
      };
    });
  }

  async listAssignments(
    employeeId: string,
    includeArchived = false,
  ): Promise<EmployeeAssignmentView[]> {
    const employee = await this.repository.findById(employeeId);
    if (!employee) {
      throwEmployeeError(
        HttpStatus.NOT_FOUND,
        'EMPLOYEE_NOT_FOUND',
        'Funcionário não encontrado.',
      );
    }
    const assignments = (employee.assignments ?? []).filter(
      (a) => includeArchived || !a.archivedAt,
    );
    return assignments.map((a) => this.mapper.toAssignmentView(a));
  }

  async createAssignment(
    employeeId: string,
    dto: CreateAssignmentDto,
    secretaryId: number,
  ): Promise<EmployeeAssignmentMutationResponse> {
    const title = normalizeDisplayText(dto.title);
    const startsOn = dto.startsOn
      ? parseIsoDateOnly(dto.startsOn, 'startsOn')
      : null;
    const validUntil = dto.validUntil
      ? parseIsoDateOnly(dto.validUntil, 'validUntil')
      : null;
    assertValidDateRange(startsOn, validUntil);

    return this.prisma.$transaction(async (tx) => {
      await this.lockEmployeeRow(tx, employeeId);
      const current = await this.repository.findById(employeeId, tx);
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

      const active = dto.active ?? true;
      const created = await tx.employeeAssignment.create({
        data: {
          employeeId,
          title,
          startsOn,
          validUntil,
          active,
          endedAt: active ? null : new Date(),
        },
      });

      const updated = await this.repository.updateAggregate(
        employeeId,
        dto.expectedVersion,
        {},
        tx,
      );
      if (!updated) {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'Conflito de versão ao adicionar função.',
        );
      }

      await tx.employeeAudit.create({
        data: {
          employeeId,
          actorRole: 'secretary',
          actorId: String(secretaryId),
          action: 'ASSIGNMENT_CREATED',
          requestId: `assign-create-${created.id}`,
          reason: normalizeDisplayText(dto.reason),
          changedFields: {
            assignmentId: created.id,
            title,
            startsOn: dto.startsOn ?? null,
            validUntil: dto.validUntil ?? null,
            active,
          },
        },
      });

      return {
        employeeId,
        version: updated.version,
        assignment: this.mapper.toAssignmentView(created),
        credential: this.mapper.toCredentialSummary(updated),
      };
    });
  }

  async updateAssignment(
    employeeId: string,
    assignmentId: string,
    dto: UpdateAssignmentDto,
    secretaryId: number,
  ): Promise<EmployeeAssignmentMutationResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockEmployeeRow(tx, employeeId);
      const current = await this.repository.findById(employeeId, tx);
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

      const assignment = await tx.employeeAssignment.findFirst({
        where: { id: assignmentId, employeeId },
      });
      if (!assignment) {
        throwEmployeeError(
          HttpStatus.NOT_FOUND,
          'EMPLOYEE_NOT_FOUND',
          'Função não encontrada para este funcionário.',
        );
      }

      const nextTitle =
        dto.title !== undefined
          ? normalizeDisplayText(dto.title)
          : assignment.title;
      const nextStartsOn =
        dto.startsOn !== undefined
          ? dto.startsOn === null
            ? null
            : parseIsoDateOnly(dto.startsOn, 'startsOn')
          : assignment.startsOn;
      const nextValidUntil =
        dto.validUntil !== undefined
          ? dto.validUntil === null
            ? null
            : parseIsoDateOnly(dto.validUntil, 'validUntil')
          : assignment.validUntil;

      assertValidDateRange(nextStartsOn, nextValidUntil);

      const nextActive =
        dto.active !== undefined ? dto.active : assignment.active;
      const nextEndedAt =
        dto.active === undefined
          ? assignment.endedAt
          : dto.active
            ? null
            : (assignment.endedAt ?? new Date());

      const savedAssignment = await tx.employeeAssignment.update({
        where: { id: assignmentId },
        data: {
          title: nextTitle,
          startsOn: nextStartsOn,
          validUntil: nextValidUntil,
          active: nextActive,
          endedAt: nextEndedAt,
        },
      });

      const updated = await this.repository.updateAggregate(
        employeeId,
        dto.expectedVersion,
        {},
        tx,
      );
      if (!updated) {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'Conflito de versão ao atualizar função.',
        );
      }

      await tx.employeeAudit.create({
        data: {
          employeeId,
          actorRole: 'secretary',
          actorId: String(secretaryId),
          action:
            dto.active === false && assignment.active
              ? 'ASSIGNMENT_ENDED'
              : 'ASSIGNMENT_UPDATED',
          requestId: `assign-update-${assignmentId}-${updated.version}`,
          reason: normalizeDisplayText(dto.reason),
          changedFields: {
            assignmentId,
            title: nextTitle,
            active: nextActive,
          },
        },
      });

      return {
        employeeId,
        version: updated.version,
        assignment: this.mapper.toAssignmentView(savedAssignment),
        credential: this.mapper.toCredentialSummary(updated),
      };
    });
  }

  async archiveAssignment(
    employeeId: string,
    assignmentId: string,
    dto: EmployeeReasonMutationDto,
    secretaryId: number,
  ): Promise<EmployeeAssignmentMutationResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockEmployeeRow(tx, employeeId);
      const current = await this.repository.findById(employeeId, tx);
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

      const assignment = await tx.employeeAssignment.findFirst({
        where: { id: assignmentId, employeeId },
      });
      if (!assignment) {
        throwEmployeeError(
          HttpStatus.NOT_FOUND,
          'EMPLOYEE_NOT_FOUND',
          'Função não encontrada para este funcionário.',
        );
      }

      const now = new Date();
      const savedAssignment = await tx.employeeAssignment.update({
        where: { id: assignmentId },
        data: {
          active: false,
          endedAt: assignment.endedAt ?? now,
          archivedAt: now,
        },
      });

      const updated = await this.repository.updateAggregate(
        employeeId,
        dto.expectedVersion,
        {},
        tx,
      );
      if (!updated) {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'Conflito de versão ao arquivar função.',
        );
      }

      await tx.employeeAudit.create({
        data: {
          employeeId,
          actorRole: 'secretary',
          actorId: String(secretaryId),
          action: 'ASSIGNMENT_ARCHIVED',
          requestId: `assign-archive-${assignmentId}-${updated.version}`,
          reason: normalizeDisplayText(dto.reason),
          changedFields: { assignmentId, archivedAt: now.toISOString() },
        },
      });

      return {
        employeeId,
        version: updated.version,
        assignment: this.mapper.toAssignmentView(savedAssignment),
        credential: this.mapper.toCredentialSummary(updated),
      };
    });
  }

  async restoreAssignment(
    employeeId: string,
    assignmentId: string,
    dto: EmployeeReasonMutationDto,
    secretaryId: number,
  ): Promise<EmployeeAssignmentMutationResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockEmployeeRow(tx, employeeId);
      const current = await this.repository.findById(employeeId, tx);
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

      const assignment = await tx.employeeAssignment.findFirst({
        where: { id: assignmentId, employeeId },
      });
      if (!assignment) {
        throwEmployeeError(
          HttpStatus.NOT_FOUND,
          'EMPLOYEE_NOT_FOUND',
          'Função não encontrada para este funcionário.',
        );
      }

      const savedAssignment = await tx.employeeAssignment.update({
        where: { id: assignmentId },
        data: {
          archivedAt: null,
          active: false,
        },
      });

      const updated = await this.repository.updateAggregate(
        employeeId,
        dto.expectedVersion,
        {},
        tx,
      );
      if (!updated) {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'Conflito de versão ao restaurar função.',
        );
      }

      await tx.employeeAudit.create({
        data: {
          employeeId,
          actorRole: 'secretary',
          actorId: String(secretaryId),
          action: 'ASSIGNMENT_RESTORED',
          requestId: `assign-restore-${assignmentId}-${updated.version}`,
          reason: normalizeDisplayText(dto.reason),
          changedFields: { assignmentId, active: false },
        },
      });

      return {
        employeeId,
        version: updated.version,
        assignment: this.mapper.toAssignmentView(savedAssignment),
        credential: this.mapper.toCredentialSummary(updated),
      };
    });
  }

  async getHistory(employeeId: string): Promise<EmployeeHistoryView> {
    const employee = await this.repository.findById(employeeId);
    if (!employee) {
      throwEmployeeError(
        HttpStatus.NOT_FOUND,
        'EMPLOYEE_NOT_FOUND',
        'Funcionário não encontrado.',
      );
    }

    const participants = await this.prisma.eventParticipant.findMany({
      where: { employeeAccountId: employee.accountId },
      include: {
        event: {
          select: { id: true, title: true, startsAt: true, endsAt: true },
        },
        attendance: {
          select: { status: true, checkInAt: true, checkOutAt: true },
        },
        certificate: {
          select: {
            id: true,
            version: true,
            verificationCode: true,
            issuedAt: true,
            revokedAt: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    return {
      employee: {
        id: employee.id,
        accountId: employee.accountId,
        displayName: this.mapper.getDisplayName(employee),
        registrationNumber: employee.registrationNumber ?? null,
        accountStatus: employee.accountStatus,
      },
      participations: participants.map((p) => ({
        participantId: p.id,
        eventId: p.event.id,
        eventTitle: p.event.title,
        eventStartsAt: p.event.startsAt.toISOString(),
        eventEndsAt: p.event.endsAt.toISOString(),
        role: p.role,
        attendanceStatus: p.attendance?.status ?? null,
        checkInAt: p.attendance?.checkInAt?.toISOString() ?? null,
        checkOutAt: p.attendance?.checkOutAt?.toISOString() ?? null,
        certificate: p.certificate
          ? {
              id: p.certificate.id,
              version: p.certificate.version,
              verificationCode: p.certificate.verificationCode,
              issuedAt: p.certificate.issuedAt.toISOString(),
              revokedAt: p.certificate.revokedAt?.toISOString() ?? null,
            }
          : null,
      })),
    };
  }

  async getAudits(
    employeeId: string,
    cursor?: string,
    limit = 25,
  ): Promise<PaginatedListResponse<EmployeeAuditItemView>> {
    const employee = await this.repository.findById(employeeId);
    if (!employee) {
      throwEmployeeError(
        HttpStatus.NOT_FOUND,
        'EMPLOYEE_NOT_FOUND',
        'Funcionário não encontrado.',
      );
    }

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const items = await this.prisma.employeeAudit.findMany({
      where: { employeeId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: safeLimit + 1,
    });

    const hasMore = items.length > safeLimit;
    const page = hasMore ? items.slice(0, safeLimit) : items;

    return {
      items: page.map((item) => ({
        id: item.id,
        actorRole: item.actorRole as 'employee' | 'secretary' | 'system',
        actorId: item.actorId,
        action: item.action,
        requestId: item.requestId,
        reason: item.reason ?? null,
        changedFields: (item.changedFields as Record<string, unknown>) ?? {},
        sourceImportBatchId: item.sourceImportBatchId ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }
}
