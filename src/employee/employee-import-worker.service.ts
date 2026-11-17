import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EmployeeImportBatchState, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { EmployeeImportBatchCounts } from '../contracts/v1-employees.types';
import { PrismaService } from '../database/prisma.service';
import { buildEmployeeSearchText } from './employee-eligibility.service';
import { generateOpaqueQrToken, parseIsoDateOnly } from './employee.errors';

const LEASE_TTL_MS = 60_000;
const GROUPS_PER_TICK = 25;
const MAX_CONCURRENCY = 3;

interface StoredRowInput {
  funcionarioId?: string | null;
  funcaoId?: string | null;
  name?: string | null;
  socialName?: string | null;
  email?: string | null;
  registrationNumber?: string | null;
  rg?: string | null;
  admissionDate?: string | null;
  assignmentTitle?: string | null;
  startsOn?: string | null;
  validUntil?: string | null;
  active?: boolean | null;
}

@Injectable()
export class EmployeeImportWorkerService {
  private readonly logger = new Logger(EmployeeImportWorkerService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('*/5 * * * * *')
  async pollPendingBatches(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.processNextBatch();
  }

  async processNextBatch(specificBatchId?: string): Promise<boolean> {
    const now = new Date();
    const leaseToken = randomUUID();
    const leaseUntil = new Date(now.getTime() + LEASE_TTL_MS);

    const candidate = await this.prisma.employeeImportBatch.findFirst({
      where: {
        ...(specificBatchId ? { id: specificBatchId } : {}),
        state: 'RUNNING',
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      orderBy: [{ confirmedAt: 'asc' }, { createdAt: 'asc' }],
    });

    if (!candidate) return false;

    const claimed = await this.prisma.employeeImportBatch.updateMany({
      where: {
        id: candidate.id,
        state: 'RUNNING',
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: {
        leaseToken,
        leaseUntil,
      },
    });

    if (claimed.count !== 1) return false;

    try {
      await this.executeBatch(
        candidate.id,
        candidate.secretaryId,
        candidate.mode,
      );
    } catch (err) {
      this.logger.error(`Erro ao processar lote ${candidate.id}`, err);
    } finally {
      await this.prisma.employeeImportBatch.updateMany({
        where: { id: candidate.id, leaseToken },
        data: { leaseToken: null, leaseUntil: null },
      });
    }

    return true;
  }

  private async executeBatch(
    batchId: string,
    secretaryId: number,
    mode: 'CREATE_ONLY' | 'UPDATE',
  ): Promise<void> {
    const secretary = await this.prisma.secretary.findUnique({
      where: { id: secretaryId },
    });
    if (!secretary || new Date() > new Date(secretary.dueDate)) {
      await this.prisma.employeeImportRow.updateMany({
        where: { batchId, state: 'PENDING' },
        data: {
          state: 'FAILED',
          errorCode: 'SECRETARY_INACTIVE',
          errorMessage:
            'Secretaria criadora do lote está inativa ou com senha vencida.',
        },
      });
      await this.finalizeBatchCounts(batchId);
      return;
    }

    const pendingRows = await this.prisma.employeeImportRow.findMany({
      where: { batchId, state: 'PENDING' },
      orderBy: [{ rowNumber: 'asc' }],
    });

    const groupsMap = new Map<string, typeof pendingRows>();
    for (const row of pendingRows) {
      const list = groupsMap.get(row.groupId) ?? [];
      list.push(row);
      groupsMap.set(row.groupId, list);
    }

    const groups = [...groupsMap.entries()].slice(0, GROUPS_PER_TICK);

    for (let i = 0; i < groups.length; i += MAX_CONCURRENCY) {
      const chunk = groups.slice(i, i + MAX_CONCURRENCY);
      await Promise.all(
        chunk.map(([groupId, rows]) =>
          this.processGroup(batchId, groupId, rows, secretaryId, mode),
        ),
      );
    }

    const remaining = await this.prisma.employeeImportRow.count({
      where: { batchId, state: 'PENDING' },
    });
    if (remaining === 0) {
      await this.finalizeBatchCounts(batchId);
    }
  }

  private async processGroup(
    batchId: string,
    groupId: string,
    rows: Array<{
      id: string;
      rowNumber: number;
      input: Prisma.JsonValue;
      employeeId: string | null;
      expectedEmployeeVersion: number | null;
    }>,
    secretaryId: number,
    mode: 'CREATE_ONLY' | 'UPDATE',
  ): Promise<void> {
    const operationKey = `${batchId}:${groupId}`;

    try {
      await this.prisma.$transaction(async (tx) => {
        // Check if this group operation was already committed previously (recovery after crash)
        const existingAudit = await tx.employeeAudit.findFirst({
          where: {
            sourceImportBatchId: batchId,
            requestId: operationKey,
          },
        });
        if (existingAudit) {
          await tx.employeeImportRow.updateMany({
            where: { batchId, groupId },
            data: {
              state: 'SUCCEEDED',
              employeeId: existingAudit.employeeId,
              operationKey,
              processedAt: new Date(),
            },
          });
          return;
        }

        const parsed = rows.map((r) => ({
          row: r,
          input: (r.input as unknown as StoredRowInput) ?? {},
        }));

        if (mode === 'CREATE_ONLY') {
          const head = parsed[0].input;
          const email = (head.email ?? '').trim().toLowerCase();
          const reg = head.registrationNumber?.trim() || null;

          const existingByEmail = await tx.employee.findUnique({
            where: { email },
            select: { id: true },
          });
          if (existingByEmail) {
            throw new ImportGroupError(
              'EMAIL_ALREADY_EXISTS',
              'E-mail já cadastrado.',
              'FAILED',
            );
          }
          if (reg) {
            const existingByReg = await tx.employee.findUnique({
              where: { registrationNumber: reg },
              select: { id: true },
            });
            if (existingByReg) {
              throw new ImportGroupError(
                'REGISTRATION_ALREADY_EXISTS',
                'Matrícula já cadastrada.',
                'FAILED',
              );
            }
          }

          const created = await tx.employee.create({
            data: {
              name: head.name as string,
              socialName: head.socialName ?? null,
              searchText: buildEmployeeSearchText({
                name: head.name as string,
                socialName: head.socialName ?? null,
                registrationNumber: reg,
              }),
              email,
              registrationNumber: reg,
              rg: head.rg ?? null,
              admissionDate: parseIsoDateOnly(
                head.admissionDate as string,
                'data_admissao',
              ),
              qrcode: generateOpaqueQrToken(),
              assignments: {
                create: parsed.map((p) => ({
                  title: p.input.assignmentTitle as string,
                  startsOn: p.input.startsOn
                    ? parseIsoDateOnly(p.input.startsOn, 'inicio_funcao')
                    : null,
                  validUntil: p.input.validUntil
                    ? parseIsoDateOnly(p.input.validUntil, 'fim_funcao')
                    : null,
                  active: p.input.active ?? true,
                })),
              },
            },
          });

          await tx.employeeAudit.create({
            data: {
              employeeId: created.id,
              actorRole: 'secretary',
              actorId: String(secretaryId),
              action: 'EMPLOYEE_IMPORTED_CREATE',
              requestId: operationKey,
              sourceImportBatchId: batchId,
              changedFields: {
                assignmentsCount: parsed.length,
              },
            },
          });

          for (const p of parsed) {
            await tx.employeeImportRow.update({
              where: { id: p.row.id },
              data: {
                state: 'SUCCEEDED',
                employeeId: created.id,
                operationKey: `${operationKey}:${p.row.rowNumber}`,
                processedAt: new Date(),
              },
            });
          }
        } else {
          // UPDATE mode
          const targetId = rows[0].employeeId;
          const expectedVersion = rows[0].expectedEmployeeVersion;
          if (!targetId || !expectedVersion) {
            throw new ImportGroupError(
              'IMPORT_ROW_STALE',
              'Versão esperada ausente para atualização.',
              'STALE',
            );
          }

          const locked = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "Employee" WHERE "id" = ${targetId} FOR UPDATE
          `;
          if (locked.length === 0) {
            throw new ImportGroupError(
              'EMPLOYEE_NOT_FOUND',
              'Funcionário não encontrado.',
              'FAILED',
            );
          }

          const current = await tx.employee.findUnique({
            where: { id: targetId },
          });
          if (!current || current.version !== expectedVersion) {
            throw new ImportGroupError(
              'IMPORT_ROW_STALE',
              'Cadastro alterado após análise do lote.',
              'STALE',
            );
          }

          const head = parsed[0].input;
          const nextName = head.name ?? current.name;
          const nextSocial =
            head.socialName !== undefined && head.socialName !== null
              ? head.socialName
              : current.socialName;
          const nextEmail = head.email
            ? head.email.trim().toLowerCase()
            : current.email;
          const nextReg =
            head.registrationNumber !== undefined &&
            head.registrationNumber !== null
              ? head.registrationNumber
              : current.registrationNumber;
          const nextRg =
            head.rg !== undefined && head.rg !== null ? head.rg : current.rg;
          const nextAdmission = head.admissionDate
            ? parseIsoDateOnly(head.admissionDate, 'data_admissao')
            : current.admissionDate;

          await tx.employee.update({
            where: { id: targetId },
            data: {
              name: nextName,
              socialName: nextSocial,
              searchText: buildEmployeeSearchText({
                name: nextName,
                socialName: nextSocial,
                registrationNumber: nextReg,
              }),
              email: nextEmail,
              registrationNumber: nextReg,
              rg: nextRg,
              admissionDate: nextAdmission,
              ...(nextEmail !== current.email
                ? { authVersion: { increment: 1 } }
                : {}),
              version: { increment: 1 },
            },
          });

          for (const p of parsed) {
            const inp = p.input;
            if (inp.funcaoId) {
              const existingAssign = await tx.employeeAssignment.findFirst({
                where: { id: inp.funcaoId, employeeId: targetId },
              });
              if (!existingAssign) {
                throw new ImportGroupError(
                  'ASSIGNMENT_NOT_OWNED',
                  'Função não pertence ao funcionário.',
                  'FAILED',
                );
              }
              await tx.employeeAssignment.update({
                where: { id: existingAssign.id },
                data: {
                  ...(inp.assignmentTitle
                    ? { title: inp.assignmentTitle }
                    : {}),
                  ...(inp.startsOn
                    ? {
                        startsOn: parseIsoDateOnly(
                          inp.startsOn,
                          'inicio_funcao',
                        ),
                      }
                    : {}),
                  ...(inp.validUntil
                    ? {
                        validUntil: parseIsoDateOnly(
                          inp.validUntil,
                          'fim_funcao',
                        ),
                      }
                    : {}),
                  ...(inp.active !== null && inp.active !== undefined
                    ? {
                        active: inp.active,
                        endedAt: inp.active
                          ? null
                          : (existingAssign.endedAt ?? new Date()),
                      }
                    : {}),
                },
              });
            } else if (inp.assignmentTitle) {
              await tx.employeeAssignment.create({
                data: {
                  employeeId: targetId,
                  title: inp.assignmentTitle,
                  startsOn: inp.startsOn
                    ? parseIsoDateOnly(inp.startsOn, 'inicio_funcao')
                    : null,
                  validUntil: inp.validUntil
                    ? parseIsoDateOnly(inp.validUntil, 'fim_funcao')
                    : null,
                  active: inp.active ?? true,
                },
              });
            }
          }

          await tx.employeeAudit.create({
            data: {
              employeeId: targetId,
              actorRole: 'secretary',
              actorId: String(secretaryId),
              action: 'EMPLOYEE_IMPORTED_UPDATE',
              requestId: operationKey,
              sourceImportBatchId: batchId,
              changedFields: {
                rowsUpdated: parsed.length,
              },
            },
          });

          for (const p of parsed) {
            await tx.employeeImportRow.update({
              where: { id: p.row.id },
              data: {
                state: 'SUCCEEDED',
                employeeId: targetId,
                operationKey: `${operationKey}:${p.row.rowNumber}`,
                processedAt: new Date(),
              },
            });
          }
        }
      });
    } catch (err) {
      const code =
        err instanceof ImportGroupError ? err.code : 'IMPORT_PROCESSING_ERROR';
      const message =
        err instanceof Error ? err.message : 'Erro ao processar grupo.';
      const state = err instanceof ImportGroupError ? err.rowState : 'FAILED';

      await this.prisma.employeeImportRow.updateMany({
        where: { batchId, groupId, state: 'PENDING' },
        data: {
          state,
          errorCode: code,
          errorMessage: message,
          processedAt: new Date(),
        },
      });
    }
  }

  private async finalizeBatchCounts(batchId: string): Promise<void> {
    const batch = await this.prisma.employeeImportBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) return;

    const rows = await this.prisma.employeeImportRow.findMany({
      where: { batchId },
      select: { decision: true, state: true, groupId: true },
    });

    const baseCounts = batch.counts as unknown as EmployeeImportBatchCounts;
    const succeeded = rows.filter((r) => r.state === 'SUCCEEDED').length;
    const failed = rows.filter((r) => r.state === 'FAILED').length;
    const stale = rows.filter((r) => r.state === 'STALE').length;
    const cancelled = rows.filter((r) => r.state === 'CANCELLED').length;

    const nextCounts: EmployeeImportBatchCounts = {
      ...baseCounts,
      succeeded,
      failed,
      stale,
      cancelled,
    };

    let nextState: EmployeeImportBatchState = 'COMPLETED';
    if (batch.state === 'CANCELLED') {
      nextState = 'CANCELLED';
    } else if (failed > 0 || stale > 0) {
      nextState = 'PARTIAL';
    }

    await this.prisma.employeeImportBatch.update({
      where: { id: batchId },
      data: {
        state: nextState,
        counts: nextCounts as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
  }
}

class ImportGroupError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly rowState: 'FAILED' | 'STALE',
  ) {
    super(message);
  }
}
