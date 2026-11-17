import { EmployeeAccountStatus, PhotoStatus } from '@prisma/client';

export interface EmployeeAssignmentEntity {
  id: string;
  employeeId: string;
  title: string;
  startsOn: Date | null;
  validUntil: Date | null;
  active: boolean;
  endedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployeePhotoSummaryEntity {
  id: string;
  reviewStatus: PhotoStatus;
  processingState: string;
  currentApproved: boolean;
  currentPending: boolean;
  reviewReason: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

export interface EmployeeEntity {
  id: string;
  accountId: string;
  name: string;
  socialName: string | null;
  searchText: string;
  email: string;
  registrationNumber: string | null;
  rg: string | null;
  admissionDate: Date;
  accountStatus: EmployeeAccountStatus;
  passwordHash: string | null;
  authVersion: number;
  version: number;
  qrcode: string;
  lastLoginAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assignments?: EmployeeAssignmentEntity[];
  photos?: EmployeePhotoSummaryEntity[];
}
