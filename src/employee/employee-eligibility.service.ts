import { Injectable } from '@nestjs/common';
import type {
  EmployeeAssignmentEffectiveStatus,
  EmployeeCredentialEvaluation,
  EmployeeCredentialReasonCode,
  EmployeeValidityKind,
} from '../contracts/v1-employees.types';
import type {
  EmployeeAssignmentEntity,
  EmployeeEntity,
  EmployeePhotoSummaryEntity,
} from './entities/employee.entity';

export function formatSaoPauloDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function dbDateToIsoDate(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

export function normalizeEmployeeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function buildEmployeeSearchText(input: {
  name: string;
  socialName?: string | null;
  registrationNumber?: string | null;
}): string {
  const parts = [
    input.name,
    input.socialName ?? '',
    input.registrationNumber ?? '',
  ]
    .map((part) => normalizeEmployeeText(part))
    .filter((part) => part.length > 0);
  return parts.join(' ');
}

@Injectable()
export class EmployeeEligibilityService {
  getAssignmentEffectiveStatus(
    assignment: Pick<
      EmployeeAssignmentEntity,
      'active' | 'archivedAt' | 'startsOn' | 'validUntil'
    >,
    now: Date = new Date(),
  ): EmployeeAssignmentEffectiveStatus {
    if (assignment.archivedAt) return 'ARCHIVED';
    if (!assignment.active) return 'ENDED';

    const today = formatSaoPauloDate(now);
    const startsOn = dbDateToIsoDate(assignment.startsOn);
    const validUntil = dbDateToIsoDate(assignment.validUntil);

    if (startsOn && startsOn > today) return 'FUTURE';
    if (validUntil && validUntil < today) return 'EXPIRED';
    return 'ACTIVE';
  }

  evaluate(
    employee: Pick<
      EmployeeEntity,
      'accountStatus' | 'archivedAt' | 'admissionDate'
    >,
    assignments: Array<
      Pick<
        EmployeeAssignmentEntity,
        'id' | 'title' | 'active' | 'archivedAt' | 'startsOn' | 'validUntil'
      >
    >,
    photos: Array<
      Pick<
        EmployeePhotoSummaryEntity,
        | 'id'
        | 'reviewStatus'
        | 'processingState'
        | 'currentApproved'
        | 'currentPending'
      >
    >,
    now: Date = new Date(),
  ): EmployeeCredentialEvaluation & {
    activeAssignments: Array<{
      id: string;
      title: string;
      validUntil: string | null;
    }>;
    approvedPhotoId: string | null;
    pendingPhotoId: string | null;
  } {
    const today = formatSaoPauloDate(now);
    const checkedAt = now.toISOString();
    const admissionIso = dbDateToIsoDate(employee.admissionDate);

    const activeAssignments = assignments
      .filter((a) => this.getAssignmentEffectiveStatus(a, now) === 'ACTIVE')
      .map((a) => ({
        id: a.id,
        title: a.title,
        validUntil: dbDateToIsoDate(a.validUntil),
      }));

    const approvedPhoto = photos.find(
      (p) =>
        p.currentApproved &&
        p.processingState === 'READY' &&
        p.reviewStatus === 'APPROVED',
    );
    const pendingPhoto = photos.find(
      (p) => p.currentPending && p.processingState === 'READY',
    );
    const latestRejected =
      !approvedPhoto && !pendingPhoto
        ? photos.find(
            (p) =>
              p.reviewStatus === 'REJECTED' && p.processingState === 'READY',
          )
        : undefined;

    let accountAllowed = true;
    let accountReason: EmployeeCredentialReasonCode | null = null;

    if (employee.archivedAt || employee.accountStatus === 'ARCHIVED') {
      accountAllowed = false;
      accountReason = 'ACCOUNT_ARCHIVED';
    } else if (employee.accountStatus === 'BLOCKED') {
      accountAllowed = false;
      accountReason = 'ACCOUNT_BLOCKED';
    } else if (admissionIso && admissionIso > today) {
      accountAllowed = false;
      accountReason = 'ADMISSION_FUTURE';
    }

    let validityKind: EmployeeValidityKind = 'NO_ACTIVE_ASSIGNMENT';
    let validUntil: string | null = null;

    if (activeAssignments.length > 0) {
      const hasIndeterminate = activeAssignments.some(
        (a) => a.validUntil === null,
      );
      if (hasIndeterminate) {
        validityKind = 'INDETERMINATE';
        validUntil = null;
      } else {
        validityKind = 'UNTIL_DATE';
        validUntil =
          activeAssignments
            .map((a) => a.validUntil as string)
            .sort()
            .at(-1) ?? null;
      }
    }

    const employmentEligible = accountAllowed && activeAssignments.length > 0;
    const hasApprovedPhoto = Boolean(approvedPhoto);
    const cardEligible = employmentEligible && hasApprovedPhoto;

    let reasonCode: EmployeeCredentialReasonCode | null = null;
    if (!accountAllowed) {
      reasonCode = accountReason;
    } else if (activeAssignments.length === 0) {
      reasonCode = 'NO_ACTIVE_ASSIGNMENT';
    } else if (!hasApprovedPhoto) {
      if (pendingPhoto) {
        reasonCode = 'PHOTO_PENDING';
      } else if (latestRejected) {
        reasonCode = 'PHOTO_REJECTED';
      } else {
        reasonCode = 'PHOTO_MISSING';
      }
    }

    return {
      valid: cardEligible,
      accountAllowed,
      employmentEligible,
      cardEligible,
      validityKind: accountAllowed ? validityKind : 'NO_ACTIVE_ASSIGNMENT',
      validUntil: accountAllowed ? validUntil : null,
      reasonCode,
      checkedAt,
      activeAssignments,
      approvedPhotoId: approvedPhoto?.id ?? null,
      pendingPhotoId: pendingPhoto?.id ?? null,
    };
  }
}
