import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { normalizeEmployeeText } from '../../employee-eligibility.service';
import type { EmployeeEntity } from '../../entities/employee.entity';
import {
  CreateEmployeeAggregateInput,
  EmployeeRepository,
  ListEmployeesParams,
  UpdateEmployeeAggregateInput,
} from '../employee.repository';

const EMPLOYEE_WITH_RELATIONS = {
  assignments: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
  photos: {
    where: {
      processingState: 'READY' as const,
    },
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 10,
    select: {
      id: true,
      reviewStatus: true,
      processingState: true,
      currentApproved: true,
      currentPending: true,
      reviewReason: true,
      createdAt: true,
      reviewedAt: true,
    },
  },
};

@Injectable()
export class PrismaEmployeeRepository implements EmployeeRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: Prisma.TransactionClient) {
    return tx ?? this.prisma;
  }

  findById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EmployeeEntity | null> {
    return this.client(tx).employee.findUnique({
      where: { id },
      include: EMPLOYEE_WITH_RELATIONS,
    });
  }

  findByAccountId(
    accountId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EmployeeEntity | null> {
    return this.client(tx).employee.findUnique({
      where: { accountId },
      include: EMPLOYEE_WITH_RELATIONS,
    });
  }

  findByEmail(
    email: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EmployeeEntity | null> {
    return this.client(tx).employee.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: EMPLOYEE_WITH_RELATIONS,
    });
  }

  findByRegistrationNumber(
    registrationNumber: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EmployeeEntity | null> {
    return this.client(tx).employee.findUnique({
      where: { registrationNumber: registrationNumber.trim() },
      include: EMPLOYEE_WITH_RELATIONS,
    });
  }

  findByQrcode(
    qrcode: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EmployeeEntity | null> {
    return this.client(tx).employee.findUnique({
      where: { qrcode },
      include: EMPLOYEE_WITH_RELATIONS,
    });
  }

  async list(
    params: ListEmployeesParams,
    tx?: Prisma.TransactionClient,
  ): Promise<{ items: EmployeeEntity[]; total: number }> {
    const db = this.client(tx);
    const where: Prisma.EmployeeWhereInput = {};

    if (!params.includeArchived) {
      where.archivedAt = null;
      where.accountStatus = params.accountStatus ?? { not: 'ARCHIVED' };
    } else if (params.accountStatus) {
      where.accountStatus = params.accountStatus;
    }

    if (params.hasRegistration === true) {
      where.registrationNumber = { not: null };
    } else if (params.hasRegistration === false) {
      where.registrationNumber = null;
    }

    const q = params.q?.trim();
    if (q) {
      const normalized = normalizeEmployeeText(q);
      where.OR = [
        { searchText: { contains: normalized, mode: 'insensitive' } },
        { registrationNumber: { contains: q, mode: 'insensitive' } },
        { email: { contains: q.toLowerCase(), mode: 'insensitive' } },
      ];
    }

    const total = await db.employee.count({ where });

    let cursorWhere: Prisma.EmployeeWhereInput = where;
    if (params.cursor) {
      const cursorRow = await db.employee.findUnique({
        where: { id: params.cursor },
        select: { id: true, name: true },
      });
      if (cursorRow) {
        cursorWhere = {
          AND: [
            where,
            {
              OR: [
                { name: { gt: cursorRow.name } },
                { name: cursorRow.name, id: { gt: cursorRow.id } },
              ],
            },
          ],
        };
      }
    }

    const items = await db.employee.findMany({
      where: cursorWhere,
      include: EMPLOYEE_WITH_RELATIONS,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: params.limit + 1,
    });

    return { items, total };
  }

  createAggregate(
    input: CreateEmployeeAggregateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<EmployeeEntity> {
    return this.client(tx).employee.create({
      data: {
        name: input.name,
        socialName: input.socialName,
        searchText: input.searchText,
        email: input.email,
        registrationNumber: input.registrationNumber,
        rg: input.rg,
        admissionDate: input.admissionDate,
        qrcode: input.qrcode,
        assignments: {
          create: input.assignments.map((a) => ({
            title: a.title,
            startsOn: a.startsOn,
            validUntil: a.validUntil,
            active: a.active,
          })),
        },
      },
      include: EMPLOYEE_WITH_RELATIONS,
    });
  }

  async updateAggregate(
    id: string,
    expectedVersion: number,
    input: UpdateEmployeeAggregateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<EmployeeEntity | null> {
    const db = this.client(tx);
    const updated = await db.employee.updateMany({
      where: { id, version: expectedVersion },
      data: {
        ...input,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) return null;
    return this.findById(id, tx);
  }
}
