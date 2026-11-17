import { HttpException, HttpStatus } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type {
  EmployeeApiErrorCode,
  EmployeeErrorEnvelope,
} from '../contracts/v1-employees.types';

export function throwEmployeeError(
  statusCode: HttpStatus,
  code: EmployeeApiErrorCode | string,
  message: string,
  extra?: {
    fieldErrors?: Record<string, string[]>;
    requestId?: string;
    currentVersion?: number;
  },
): never {
  const body: EmployeeErrorEnvelope = {
    statusCode,
    code,
    message,
    ...(extra?.fieldErrors ? { fieldErrors: extra.fieldErrors } : {}),
    ...(extra?.requestId ? { requestId: extra.requestId } : {}),
    ...(extra?.currentVersion !== undefined
      ? { currentVersion: extra.currentVersion }
      : {}),
  };
  throw new HttpException(body, statusCode);
}

export function parseIsoDateOnly(
  value: string,
  fieldName: string,
): Date {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    throwEmployeeError(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_ERROR',
      `Campo ${fieldName} deve estar no formato YYYY-MM-DD.`,
      { fieldErrors: { [fieldName]: ['Formato esperado: YYYY-MM-DD'] } },
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throwEmployeeError(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_ERROR',
      `Data inválida em ${fieldName}.`,
      { fieldErrors: { [fieldName]: ['Data de calendário inválida'] } },
    );
  }
  return date;
}

export function assertValidDateRange(
  startsOn: Date | null,
  validUntil: Date | null,
): void {
  if (startsOn && validUntil && validUntil.getTime() < startsOn.getTime()) {
    throwEmployeeError(
      HttpStatus.BAD_REQUEST,
      'DATE_RANGE_INVALID',
      'validUntil deve ser igual ou posterior a startsOn.',
      {
        fieldErrors: {
          validUntil: ['A data final deve ser igual ou posterior à data inicial'],
        },
      },
    );
  }
}

export function normalizeDisplayText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeOptionalCode(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function generateOpaqueQrToken(): string {
  return randomBytes(24).toString('base64url'); // 192 bits entropy
}

export function hashPayload(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
