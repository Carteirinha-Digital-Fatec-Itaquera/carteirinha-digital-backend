import type { EmployeeAccountStatus, Prisma } from '@prisma/client';
import type { EmployeeEntity } from '../entities/employee.entity';

export interface ListEmployeesParams {
  q?: string;
  accountStatus?: EmployeeAccountStatus;
  hasRegistration?: boolean;
  includeArchived?: boolean;
  cursor?: string;
  limit: number;
}

export interface CreateEmployeeAggregateInput {
  name: string;
  socialName: string | null;
  searchText: string;
  email: string;
  registrationNumber: string | null;
  rg: string | null;
  admissionDate: Date;
  qrcode: string;
  assignments: Array<{
    title: string;
    startsOn: Date | null;
    validUntil: Date | null;
    active: boolean;
  }>;
}

export interface UpdateEmployeeAggregateInput {
  name?: string;
  socialName?: string | null;
  searchText?: string;
  email?: string;
  registrationNumber?: string | null;
  rg?: string | null;
  admissionDate?: Date;
  accountStatus?: EmployeeAccountStatus;
  passwordHash?: string | null;
  authVersion?: number;
  qrcode?: string;
  lastLoginAt?: Date | null;
  archivedAt?: Date | null;
}

export abstract class EmployeeRepository {
  abstract findById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EmployeeEntity | null>;

  abstract findByAccountId(
    accountId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EmployeeEntity | null>;

  abstract findByEmail(
    email: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EmployeeEntity | null>;

  abstract findByRegistrationNumber(
    registrationNumber: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EmployeeEntity | null>;

  abstract findByQrcode(
    qrcode: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EmployeeEntity | null>;

  abstract list(
    params: ListEmployeesParams,
    tx?: Prisma.TransactionClient,
  ): Promise<{ items: EmployeeEntity[]; total: number }>;

  abstract createAggregate(
    input: CreateEmployeeAggregateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<EmployeeEntity>;

  abstract updateAggregate(
    id: string,
    expectedVersion: number,
    input: UpdateEmployeeAggregateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<EmployeeEntity | null>;
}
