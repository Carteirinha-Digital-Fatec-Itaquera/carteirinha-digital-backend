import { Injectable } from '@nestjs/common';
import type {
  EmployeeAssignmentView,
  EmployeeCredentialSummary,
  EmployeeListItemView,
  EmployeePhotoSummary,
  EmployeeProfileView,
} from '../../contracts/v1-employees.types';
import {
  dbDateToIsoDate,
  EmployeeEligibilityService,
} from '../employee-eligibility.service';
import type {
  EmployeeAssignmentEntity,
  EmployeeEntity,
  EmployeePhotoSummaryEntity,
} from '../entities/employee.entity';

@Injectable()
export class EmployeeMapper {
  constructor(private readonly eligibility: EmployeeEligibilityService) {}

  getDisplayName(employee: Pick<EmployeeEntity, 'name' | 'socialName'>): string {
    const social = employee.socialName?.trim();
    return social && social.length > 0 ? social : employee.name;
  }

  toAssignmentView(
    assignment: EmployeeAssignmentEntity,
    now: Date = new Date(),
  ): EmployeeAssignmentView {
    return {
      id: assignment.id,
      title: assignment.title,
      startsOn: dbDateToIsoDate(assignment.startsOn),
      validUntil: dbDateToIsoDate(assignment.validUntil),
      active: assignment.active,
      effectiveStatus: this.eligibility.getAssignmentEffectiveStatus(assignment, now),
      endedAt: assignment.endedAt ? assignment.endedAt.toISOString() : null,
      archivedAt: assignment.archivedAt ? assignment.archivedAt.toISOString() : null,
    };
  }

  toPhotoSummary(photos: EmployeePhotoSummaryEntity[]): EmployeePhotoSummary {
    const approved = photos.find(
      (p) =>
        p.currentApproved &&
        p.processingState === 'READY' &&
        p.reviewStatus === 'APPROVED',
    );
    const pending = photos.find(
      (p) => p.currentPending && p.processingState === 'READY',
    );
    const latestRejected =
      !approved && !pending
        ? photos.find(
            (p) => p.reviewStatus === 'REJECTED' && p.processingState === 'READY',
          )
        : undefined;

    return {
      approvedPhotoId: approved?.id ?? null,
      pendingPhotoId: pending?.id ?? null,
      reviewStatus: pending
        ? 'PENDING'
        : approved
          ? 'APPROVED'
          : latestRejected
            ? 'REJECTED'
            : null,
      reviewReason: pending?.reviewReason ?? latestRejected?.reviewReason ?? null,
    };
  }

  toCredentialSummary(
    employee: EmployeeEntity,
    now: Date = new Date(),
  ): EmployeeCredentialSummary {
    const evaluation = this.eligibility.evaluate(
      employee,
      employee.assignments ?? [],
      employee.photos ?? [],
      now,
    );
    return {
      valid: evaluation.valid,
      validityKind: evaluation.validityKind,
      validUntil: evaluation.validUntil,
      reasonCode: evaluation.reasonCode,
      checkedAt: evaluation.checkedAt,
    };
  }

  toProfileView(
    employee: EmployeeEntity,
    options?: { includeRg?: boolean; now?: Date },
  ): EmployeeProfileView {
    const now = options?.now ?? new Date();
    const assignments = employee.assignments ?? [];
    const photos = employee.photos ?? [];

    return {
      id: employee.id,
      accountId: employee.accountId,
      profileType: 'EMPLOYEE',
      name: employee.name,
      socialName: employee.socialName ?? null,
      displayName: this.getDisplayName(employee),
      email: employee.email,
      registrationNumber: employee.registrationNumber ?? null,
      rg: options?.includeRg ? (employee.rg ?? null) : null,
      admissionDate: dbDateToIsoDate(employee.admissionDate) as string,
      accountStatus: employee.accountStatus,
      version: employee.version,
      assignments: assignments.map((a) => this.toAssignmentView(a, now)),
      credential: this.toCredentialSummary(employee, now),
      photo: this.toPhotoSummary(photos),
    };
  }

  toListItemView(
    employee: EmployeeEntity,
    now: Date = new Date(),
  ): EmployeeListItemView {
    const assignments = employee.assignments ?? [];
    const photos = employee.photos ?? [];
    const evaluation = this.eligibility.evaluate(employee, assignments, photos, now);

    return {
      id: employee.id,
      accountId: employee.accountId,
      name: employee.name,
      socialName: employee.socialName ?? null,
      displayName: this.getDisplayName(employee),
      email: employee.email,
      registrationNumber: employee.registrationNumber ?? null,
      admissionDate: dbDateToIsoDate(employee.admissionDate) as string,
      accountStatus: employee.accountStatus,
      version: employee.version,
      activeAssignmentsCount: evaluation.activeAssignments.length,
      assignmentTitles: evaluation.activeAssignments.map((a) => a.title),
      credential: {
        valid: evaluation.valid,
        validityKind: evaluation.validityKind,
        validUntil: evaluation.validUntil,
        reasonCode: evaluation.reasonCode,
        checkedAt: evaluation.checkedAt,
      },
      photo: this.toPhotoSummary(photos),
      archivedAt: employee.archivedAt ? employee.archivedAt.toISOString() : null,
    };
  }
}
