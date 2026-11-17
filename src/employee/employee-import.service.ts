import { HttpStatus, Injectable } from '@nestjs/common';
import {
  EmployeeImportBatch,
  EmployeeImportBatchState,
  EmployeeImportMode,
  EmployeeImportRowDecision,
  EmployeeImportRowState,
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import type {
  EmployeeImportBatchCounts,
  EmployeeImportBatchView,
  EmployeeImportRowView,
  EmployeeImportTemplateMetadata,
  PaginatedListResponse,
} from '../contracts/v1-employees.types';
import { PrismaService } from '../database/prisma.service';
import {
  CancelEmployeeImportDto,
  ConfirmEmployeeImportDto,
  ReprocessEmployeeImportDto,
} from './dto/employee-import.dto';
import { throwEmployeeError } from './employee.errors';
import {
  buildEmployeeImportTemplateCsv,
  buildEmployeeImportTemplateXlsx,
  EMPLOYEE_IMPORT_COLUMNS,
  EMPLOYEE_IMPORT_MAX_FILE_BYTES,
  EMPLOYEE_IMPORT_MAX_ROWS,
  EMPLOYEE_IMPORT_SCHEMA_VERSION,
  EMPLOYEE_IMPORT_SHEET_NAME,
  neutralizeFormula,
  parseEmployeeImportFile,
  ParsedEmployeeImportRow,
} from './employee-import.parser';

const BATCH_TTL_MS = 48 * 60 * 60 * 1000;

@Injectable()
export class EmployeeImportService {
  constructor(private readonly prisma: PrismaService) {}

  getTemplateMetadata(): EmployeeImportTemplateMetadata {
    return {
      schemaVersion: EMPLOYEE_IMPORT_SCHEMA_VERSION,
      sheetName: EMPLOYEE_IMPORT_SHEET_NAME,
      maxFileSizeBytes: EMPLOYEE_IMPORT_MAX_FILE_BYTES,
      maxRows: EMPLOYEE_IMPORT_MAX_ROWS,
      columns: [...EMPLOYEE_IMPORT_COLUMNS],
    };
  }

  getTemplateFile(format: 'csv' | 'xlsx'): {
    buffer: Buffer;
    contentType: string;
    filename: string;
  } {
    if (format === 'xlsx') {
      return {
        buffer: buildEmployeeImportTemplateXlsx(),
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: 'modelo-importacao-funcionarios-v1.xlsx',
      };
    }
    return {
      buffer: Buffer.from(buildEmployeeImportTemplateCsv(), 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      filename: 'modelo-importacao-funcionarios-v1.csv',
    };
  }

  async analyze(
    file: Express.Multer.File | undefined,
    mode: EmployeeImportMode,
    secretaryId: number,
  ): Promise<EmployeeImportBatchView> {
    if (!file) {
      throwEmployeeError(
        HttpStatus.BAD_REQUEST,
        'IMPORT_SCHEMA_INVALID',
        'Arquivo obrigatório para análise.',
      );
    }

    const parsedRows = parseEmployeeImportFile({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
    });

    const fileHash = createHash('sha256').update(file.buffer).digest('hex');

    // Group rows by person key
    const groupsMap = new Map<string, ParsedEmployeeImportRow[]>();
    for (const row of parsedRows) {
      const key =
        mode === 'UPDATE'
          ? row.funcionarioId
            ? `id:${row.funcionarioId}`
            : `row:${row.rowNumber}`
          : row.email
            ? `email:${row.email}`
            : row.registrationNumber
              ? `reg:${row.registrationNumber}`
              : `row:${row.rowNumber}`;
      const list = groupsMap.get(key) ?? [];
      list.push(row);
      groupsMap.set(key, list);
    }

    const rowInserts: Array<{
      rowNumber: number;
      groupKey: string;
      groupId: string;
      input: Prisma.InputJsonValue;
      decision: EmployeeImportRowDecision;
      state: EmployeeImportRowState;
      employeeId: string | null;
      expectedEmployeeVersion: number | null;
      errorCode: string | null;
      errorMessage: string | null;
    }> = [];

    const digestParts: Array<{
      groupId: string;
      decision: EmployeeImportRowDecision;
      rows: number[];
    }> = [];

    const counts: EmployeeImportBatchCounts = {
      totalRows: parsedRows.length,
      totalGroups: groupsMap.size,
      readyCreate: 0,
      readyUpdate: 0,
      exists: 0,
      invalid: 0,
      ambiguous: 0,
      succeeded: 0,
      failed: 0,
      stale: 0,
      cancelled: 0,
    };

    for (const [groupKey, groupRows] of groupsMap.entries()) {
      const groupId = randomUUID();
      const firstError = groupRows.find((r) => r.rowErrorCode !== null);

      let decision: EmployeeImportRowDecision =
        mode === 'CREATE_ONLY' ? 'READY_CREATE' : 'READY_UPDATE';
      let employeeId: string | null = null;
      let expectedEmployeeVersion: number | null = null;
      let errorCode: string | null = null;
      let errorMessage: string | null = null;

      if (firstError) {
        decision = 'INVALID';
        errorCode = firstError.rowErrorCode;
        errorMessage = firstError.rowErrorMessage;
      } else if (mode === 'CREATE_ONLY') {
        const missing = groupRows.find(
          (r) =>
            !r.name || !r.email || !r.admissionDate || !r.assignmentTitle,
        );
        const hasIds = groupRows.find((r) => r.funcionarioId || r.funcaoId);
        if (hasIds) {
          decision = 'INVALID';
          errorCode = 'IDS_NOT_ALLOWED_IN_CREATE';
          errorMessage =
            'funcionario_id e funcao_id devem ficar vazios no modo CREATE_ONLY.';
        } else if (missing) {
          decision = 'INVALID';
          errorCode = 'MISSING_REQUIRED_FIELDS';
          errorMessage =
            'nome_completo, email, data_admissao e funcao são obrigatórios na criação.';
        } else if (this.hasGroupPersonConflict(groupRows)) {
          decision = 'INVALID';
          errorCode = 'GROUP_DATA_CONFLICT';
          errorMessage =
            'Linhas da mesma pessoa possuem dados pessoais conflitantes.';
        } else {
          const email = groupRows[0].email as string;
          const reg = groupRows[0].registrationNumber;
          const byEmail = await this.prisma.employee.findUnique({
            where: { email },
            select: { id: true },
          });
          const byReg = reg
            ? await this.prisma.employee.findUnique({
                where: { registrationNumber: reg },
                select: { id: true },
              })
            : null;

          if (byEmail && byReg && byEmail.id !== byReg.id) {
            decision = 'AMBIGUOUS';
            employeeId = byEmail.id;
            errorCode = 'CONFLICTING_EXISTING_IDENTITIES';
            errorMessage =
              'E-mail e matrícula pertencem a funcionários diferentes.';
          } else if (byEmail || byReg) {
            decision = 'EXISTS';
            employeeId = (byEmail ?? byReg)!.id;
            errorCode = byEmail
              ? 'EMAIL_ALREADY_EXISTS'
              : 'REGISTRATION_ALREADY_EXISTS';
            errorMessage = 'Funcionário já cadastrado; modo CREATE_ONLY não sobrescreve.';
          }
        }
      } else {
        // UPDATE mode
        const targetId = groupRows[0].funcionarioId;
        if (!targetId || !/^[0-9a-f-]{36}$/i.test(targetId)) {
          decision = 'INVALID';
          errorCode = 'EMPLOYEE_ID_REQUIRED';
          errorMessage = 'funcionario_id válido é obrigatório no modo UPDATE.';
        } else if (this.hasGroupPersonConflict(groupRows)) {
          decision = 'INVALID';
          errorCode = 'GROUP_DATA_CONFLICT';
          errorMessage =
            'Linhas da mesma pessoa possuem dados pessoais conflitantes.';
        } else {
          const existing = await this.prisma.employee.findUnique({
            where: { id: targetId },
            include: { assignments: { select: { id: true } } },
          });
          if (!existing) {
            decision = 'INVALID';
            errorCode = 'EMPLOYEE_NOT_FOUND';
            errorMessage = 'Funcionário não encontrado para funcionario_id.';
          } else {
            employeeId = existing.id;
            expectedEmployeeVersion = existing.version;
            const ownedAssignmentIds = new Set(
              existing.assignments.map((a) => a.id),
            );
            const badAssignment = groupRows.find(
              (r) => r.funcaoId && !ownedAssignmentIds.has(r.funcaoId),
            );
            if (badAssignment) {
              decision = 'INVALID';
              errorCode = 'ASSIGNMENT_NOT_OWNED';
              errorMessage = `funcao_id ${badAssignment.funcaoId} não pertence ao funcionário.`;
            } else {
              const newEmail = groupRows.find((r) => r.email)?.email;
              if (newEmail && newEmail !== existing.email) {
                const emailOwner = await this.prisma.employee.findUnique({
                  where: { email: newEmail },
                  select: { id: true },
                });
                if (emailOwner && emailOwner.id !== existing.id) {
                  decision = 'AMBIGUOUS';
                  errorCode = 'EMAIL_ALREADY_EXISTS';
                  errorMessage = 'Novo e-mail já pertence a outro funcionário.';
                }
              }
              const newReg = groupRows.find(
                (r) => r.registrationNumber,
              )?.registrationNumber;
              if (
                decision === 'READY_UPDATE' &&
                newReg &&
                newReg !== existing.registrationNumber
              ) {
                const regOwner = await this.prisma.employee.findUnique({
                  where: { registrationNumber: newReg },
                  select: { id: true },
                });
                if (regOwner && regOwner.id !== existing.id) {
                  decision = 'AMBIGUOUS';
                  errorCode = 'REGISTRATION_ALREADY_EXISTS';
                  errorMessage =
                    'Nova matrícula já pertence a outro funcionário.';
                }
              }
            }
          }
        }
      }

      if (decision === 'READY_CREATE') counts.readyCreate++;
      else if (decision === 'READY_UPDATE') counts.readyUpdate++;
      else if (decision === 'EXISTS') counts.exists++;
      else if (decision === 'AMBIGUOUS') counts.ambiguous++;
      else counts.invalid++;

      digestParts.push({
        groupId,
        decision,
        rows: groupRows.map((r) => r.rowNumber).sort((a, b) => a - b),
      });

      for (const r of groupRows) {
        const effectiveActive =
          mode === 'CREATE_ONLY' && r.active === null ? true : r.active;
        rowInserts.push({
          rowNumber: r.rowNumber,
          groupKey,
          groupId,
          input: {
            funcionarioId: r.funcionarioId,
            funcaoId: r.funcaoId,
            name: r.name,
            socialName: r.socialName,
            email: r.email,
            registrationNumber: r.registrationNumber,
            rg: r.rg,
            hasRg: Boolean(r.rg),
            admissionDate: r.admissionDate,
            assignmentTitle: r.assignmentTitle,
            startsOn: r.startsOn,
            validUntil: r.validUntil,
            active: effectiveActive,
            activeDefaulted: mode === 'CREATE_ONLY' && r.active === null,
          } as Prisma.InputJsonValue,
          decision,
          state:
            decision === 'READY_CREATE' || decision === 'READY_UPDATE'
              ? 'PENDING'
              : 'FAILED',
          employeeId,
          expectedEmployeeVersion,
          errorCode,
          errorMessage,
        });
      }
    }

    const reviewDigest = createHash('sha256')
      .update(JSON.stringify(digestParts))
      .digest('hex');

    const batch = await this.prisma.employeeImportBatch.create({
      data: {
        secretaryId,
        fileHash,
        schemaVersion: EMPLOYEE_IMPORT_SCHEMA_VERSION,
        mode,
        state: 'ANALYZED',
        revision: 1,
        reviewDigest,
        counts: counts as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + BATCH_TTL_MS),
        rows: {
          create: rowInserts,
        },
      },
    });

    return this.toBatchView(batch);
  }

  private hasGroupPersonConflict(rows: ParsedEmployeeImportRow[]): boolean {
    if (rows.length <= 1) return false;
    const fields: Array<keyof ParsedEmployeeImportRow> = [
      'name',
      'socialName',
      'email',
      'registrationNumber',
      'rg',
      'admissionDate',
    ];
    for (const field of fields) {
      const values = new Set(
        rows
          .map((r) => r[field])
          .filter((v) => v !== null && v !== undefined && v !== ''),
      );
      if (values.size > 1) return true;
    }
    return false;
  }

  async getBatch(batchId: string): Promise<EmployeeImportBatchView> {
    const batch = await this.prisma.employeeImportBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) {
      throwEmployeeError(
        HttpStatus.NOT_FOUND,
        'EMPLOYEE_NOT_FOUND',
        'Lote de importação não encontrado.',
      );
    }
    return this.toBatchView(batch);
  }

  async getBatchRows(
    batchId: string,
    cursor?: string,
    limit = 25,
  ): Promise<PaginatedListResponse<EmployeeImportRowView>> {
    const batch = await this.prisma.employeeImportBatch.findUnique({
      where: { id: batchId },
      select: { id: true },
    });
    if (!batch) {
      throwEmployeeError(
        HttpStatus.NOT_FOUND,
        'EMPLOYEE_NOT_FOUND',
        'Lote de importação não encontrado.',
      );
    }

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const rows = await this.prisma.employeeImportRow.findMany({
      where: { batchId },
      orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: safeLimit + 1,
    });

    const hasMore = rows.length > safeLimit;
    const page = hasMore ? rows.slice(0, safeLimit) : rows;

    return {
      items: page.map((r) => {
        const raw = (r.input as Record<string, unknown>) ?? {};
        return {
          id: r.id,
          rowNumber: r.rowNumber,
          groupId: r.groupId,
          decision: r.decision,
          state: r.state,
          employeeId: r.employeeId ?? null,
          expectedEmployeeVersion: r.expectedEmployeeVersion ?? null,
          errorCode: r.errorCode ?? null,
          errorMessage: r.errorMessage ?? null,
          input: {
            name: (raw.name as string | null) ?? null,
            socialName: (raw.socialName as string | null) ?? null,
            email: (raw.email as string | null) ?? null,
            registrationNumber: (raw.registrationNumber as string | null) ?? null,
            hasRg: Boolean(raw.hasRg),
            admissionDate: (raw.admissionDate as string | null) ?? null,
            assignmentTitle: (raw.assignmentTitle as string | null) ?? null,
            startsOn: (raw.startsOn as string | null) ?? null,
            validUntil: (raw.validUntil as string | null) ?? null,
            active: (raw.active as boolean | null) ?? null,
          },
        };
      }),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async confirm(
    batchId: string,
    dto: ConfirmEmployeeImportDto,
    secretaryId: number,
  ): Promise<EmployeeImportBatchView> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "EmployeeImportBatch" WHERE "id" = ${batchId} FOR UPDATE
      `;
      if (locked.length === 0) {
        throwEmployeeError(
          HttpStatus.NOT_FOUND,
          'EMPLOYEE_NOT_FOUND',
          'Lote de importação não encontrado.',
        );
      }

      const batch = await tx.employeeImportBatch.findUnique({
        where: { id: batchId },
      });
      if (!batch) {
        throwEmployeeError(
          HttpStatus.NOT_FOUND,
          'EMPLOYEE_NOT_FOUND',
          'Lote de importação não encontrado.',
        );
      }

      if (batch.secretaryId !== secretaryId) {
        throwEmployeeError(
          HttpStatus.FORBIDDEN,
          'ROLE_FORBIDDEN',
          'Somente a Secretaria criadora do lote pode confirmá-lo.',
        );
      }

      if (batch.requestId === dto.requestId) {
        return this.toBatchView(batch);
      }
      if (batch.requestId && batch.requestId !== dto.requestId) {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'REQUEST_ID_REUSED',
          'Lote já confirmado com outro requestId.',
          { requestId: dto.requestId },
        );
      }

      if (batch.expiresAt.getTime() <= Date.now()) {
        await tx.employeeImportBatch.update({
          where: { id: batchId },
          data: { state: 'EXPIRED' },
        });
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'IMPORT_REVIEW_CHANGED',
          'A análise do lote expirou. Realize uma nova análise.',
        );
      }

      if (
        batch.state !== 'ANALYZED' ||
        batch.revision !== dto.revision ||
        batch.reviewDigest !== dto.reviewDigest
      ) {
        throwEmployeeError(
          HttpStatus.CONFLICT,
          'IMPORT_REVIEW_CHANGED',
          'O estado ou revisão do lote mudou. Recarregue a prévia.',
        );
      }

      const eligibleRows = await tx.employeeImportRow.findMany({
        where: {
          batchId,
          decision: { in: ['READY_CREATE', 'READY_UPDATE'] },
        },
        select: { groupId: true },
      });
      const eligibleGroups = new Set(eligibleRows.map((r) => r.groupId));
      const selectedSet = new Set(dto.selectedGroupIds);

      for (const gid of selectedSet) {
        if (!eligibleGroups.has(gid)) {
          throwEmployeeError(
            HttpStatus.BAD_REQUEST,
            'VALIDATION_ERROR',
            `Grupo ${gid} não é elegível para confirmação.`,
          );
        }
      }

      // Mark unselected eligible groups as CANCELLED
      await tx.employeeImportRow.updateMany({
        where: {
          batchId,
          decision: { in: ['READY_CREATE', 'READY_UPDATE'] },
          groupId: { notIn: [...selectedSet] },
        },
        data: { state: 'CANCELLED' },
      });

      const updated = await tx.employeeImportBatch.update({
        where: { id: batchId },
        data: {
          state: 'RUNNING',
          requestId: dto.requestId,
          confirmedAt: new Date(),
        },
      });

      return this.toBatchView(updated);
    });
  }

  async cancel(
    batchId: string,
    dto: CancelEmployeeImportDto,
    secretaryId: number,
  ): Promise<EmployeeImportBatchView> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.employeeImportBatch.findUnique({
        where: { id: batchId },
      });
      if (!batch) {
        throwEmployeeError(
          HttpStatus.NOT_FOUND,
          'EMPLOYEE_NOT_FOUND',
          'Lote não encontrado.',
        );
      }
      if (batch.secretaryId !== secretaryId) {
        throwEmployeeError(
          HttpStatus.FORBIDDEN,
          'ROLE_FORBIDDEN',
          'Somente a Secretaria criadora do lote pode cancelá-lo.',
        );
      }
      if (batch.state === 'COMPLETED' || batch.state === 'CANCELLED') {
        return this.toBatchView(batch);
      }

      await tx.employeeImportRow.updateMany({
        where: { batchId, state: 'PENDING' },
        data: { state: 'CANCELLED' },
      });

      const updated = await tx.employeeImportBatch.update({
        where: { id: batchId },
        data: {
          state: 'CANCELLED',
          finishedAt: new Date(),
        },
      });

      await tx.employeeAudit.create({
        data: {
          actorRole: 'secretary',
          actorId: String(secretaryId),
          action: 'IMPORT_BATCH_CANCELLED',
          requestId: dto.requestId,
          reason: dto.reason,
          changedFields: { batchId },
          sourceImportBatchId: batchId,
        },
      });

      return this.toBatchView(updated);
    });
  }

  async reprocess(
    batchId: string,
    dto: ReprocessEmployeeImportDto,
    secretaryId: number,
  ): Promise<EmployeeImportBatchView> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.employeeImportBatch.findUnique({
        where: { id: batchId },
      });
      if (!batch) {
        throwEmployeeError(
          HttpStatus.NOT_FOUND,
          'EMPLOYEE_NOT_FOUND',
          'Lote não encontrado.',
        );
      }
      if (batch.secretaryId !== secretaryId) {
        throwEmployeeError(
          HttpStatus.FORBIDDEN,
          'ROLE_FORBIDDEN',
          'Somente a Secretaria criadora pode reprocessar grupos.',
        );
      }

      const recoverable = await tx.employeeImportRow.updateMany({
        where: {
          batchId,
          groupId: { in: dto.groupIds },
          decision: { in: ['READY_CREATE', 'READY_UPDATE'] },
          state: { in: ['FAILED', 'STALE'] },
        },
        data: {
          state: 'PENDING',
          errorCode: null,
          errorMessage: null,
        },
      });

      if (recoverable.count === 0) {
        return this.toBatchView(batch);
      }

      const updated = await tx.employeeImportBatch.update({
        where: { id: batchId },
        data: {
          state: 'RUNNING',
          finishedAt: null,
        },
      });

      return this.toBatchView(updated);
    });
  }

  async exportReport(
    batchId: string,
    format: 'csv' | 'xlsx',
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const batch = await this.prisma.employeeImportBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) {
      throwEmployeeError(
        HttpStatus.NOT_FOUND,
        'EMPLOYEE_NOT_FOUND',
        'Lote não encontrado.',
      );
    }

    const rows = await this.prisma.employeeImportRow.findMany({
      where: { batchId },
      orderBy: [{ rowNumber: 'asc' }],
    });

    const headers = [
      'linha',
      'grupo_id',
      'decisao',
      'estado',
      'funcionario_id',
      'codigo_erro',
      'mensagem_erro',
    ];

    const dataRows = rows.map((r) => [
      String(r.rowNumber),
      r.groupId,
      r.decision,
      r.state,
      r.employeeId ?? '',
      neutralizeFormula(r.errorCode ?? ''),
      neutralizeFormula(r.errorMessage ?? ''),
    ]);

    if (format === 'xlsx') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
      XLSX.utils.book_append_sheet(wb, ws, 'Relatorio');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      return {
        buffer,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: `relatorio-importacao-${batchId}.xlsx`,
      };
    }

    const csvEscape = (v: string) => {
      const safe = neutralizeFormula(v);
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const lines = [
      headers.join(','),
      ...dataRows.map((row) => row.map(csvEscape).join(',')),
    ];
    return {
      buffer: Buffer.from(`\uFEFF${lines.join('\n')}\n`, 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      filename: `relatorio-importacao-${batchId}.csv`,
    };
  }

  toBatchView(batch: EmployeeImportBatch): EmployeeImportBatchView {
    return {
      batchId: batch.id,
      schemaVersion: batch.schemaVersion,
      mode: batch.mode,
      state: batch.state,
      revision: batch.revision,
      reviewDigest: batch.reviewDigest,
      counts: batch.counts as unknown as EmployeeImportBatchCounts,
      expiresAt: batch.expiresAt.toISOString(),
      confirmedAt: batch.confirmedAt?.toISOString() ?? null,
      finishedAt: batch.finishedAt?.toISOString() ?? null,
      createdAt: batch.createdAt.toISOString(),
    };
  }
}
