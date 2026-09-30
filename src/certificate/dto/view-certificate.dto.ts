import type { CertificateSnapshot } from '../certificate.snapshot';

export interface CertificateView {
  id: string;
  eventId: string;
  attendanceId: string;
  verificationCode: string;
  payloadSnapshot: CertificateSnapshot;
  issuedAt: string;
  revokedAt: string | null;
}

export interface CertificateListItem {
  id: string;
  eventId: string;
  verificationCode: string;
  eventTitle: string;
  eventDate: string;
  workload: string;
  issuedAt: string;
  revokedAt: string | null;
}

export interface CertificateVerificationValid {
  valid: true;
  code: string;
  studentName: string;
  eventTitle: string;
  eventDate: string;
  workload: string;
  issuedAt: string;
  institution: string;
}

export interface CertificateVerificationRevoked {
  valid: false;
  code: string;
  revoked: true;
  message: string;
}

export type CertificateVerificationResponse =
  | CertificateVerificationValid
  | CertificateVerificationRevoked;
