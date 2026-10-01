/**
 * Contrato de transporte V1 de Eventos, Presença e Certificados.
 * Tipos portáveis: não importam NestJS, Prisma nem bibliotecas de runtime.
 * A validação HTTP será implementada por classes DTO com class-validator
 * nos módulos correspondentes (#24, #25, #26 e #27).
 */
export type EventStatus =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';
export type CheckpointType = 'CHECK_IN' | 'CHECK_OUT';
export type AttendanceStatus = 'CHECKED_IN' | 'CONFIRMED';
export type ApiRole = 'student' | 'secretary';
export type IsoDateTime = string;
export type Uuid = string;

export interface CheckpointView {
  id: Uuid;
  eventId: Uuid;
  type: CheckpointType;
  isOpen: boolean;
  version: number;
  openedAt: IsoDateTime | null;
  closedAt: IsoDateTime | null;
}

export interface EventView {
  id: Uuid;
  title: string;
  description: string | null;
  speaker: string;
  location: string;
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
  workloadMinutes: number;
  status: EventStatus;
  cancelReason: string | null;
  cancelledAt: IsoDateTime | null;
  cancelledById: number | null;
  certificateEnabled: boolean;
  checkpoints: CheckpointView[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CreateEventRequest {
  title: string;
  description?: string;
  speaker: string;
  location: string;
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
  workloadMinutes: number;
  certificateEnabled?: boolean;
}

export interface CancelEventRequest {
  reason: string;
}

export interface UpdateEventRequest extends Partial<CreateEventRequest> {
  status?: 'CANCELLED';
  cancelReason?: string;
}

export interface CheckpointMutationResponse {
  eventId: Uuid;
  type: CheckpointType;
  isOpen: boolean;
  version: number;
  openedAt: IsoDateTime | null;
  closedAt: IsoDateTime | null;
}

export interface AttendanceQrResponse {
  qrToken: string;
  expiresInSeconds: 20;
  expiresAt: IsoDateTime;
  checkpointVersion: number;
}

export interface AttendanceScanRequest {
  qrToken: string;
}

export interface AttendanceScanSuccess {
  success: true;
  type: CheckpointType;
  eventTitle: string;
  timestamp: IsoDateTime;
  status: AttendanceStatus;
  message: string;
}

export interface AttendanceScanDuplicate {
  success: false;
  code: 'ALREADY_CHECKED_IN' | 'ALREADY_CHECKED_OUT';
  message: string;
  timestamp: IsoDateTime;
}

export type AttendanceScanResponse =
  | AttendanceScanSuccess
  | AttendanceScanDuplicate;

export interface AttendanceView {
  id: Uuid;
  eventId: Uuid;
  eventTitle: string;
  studentRa: string;
  studentName: string;
  studentCourse: string;
  checkInAt: IsoDateTime | null;
  checkOutAt: IsoDateTime | null;
  status: AttendanceStatus;
}

export interface MyAttendanceView {
  id: Uuid;
  eventId: Uuid;
  eventTitle: string;
  checkInAt: IsoDateTime | null;
  checkOutAt: IsoDateTime | null;
  status: AttendanceStatus;
}

export interface AttendanceSummary {
  checkedInCount: number;
  checkedOutCount: number;
  confirmedCount: number;
}

export interface CertificateSnapshot {
  studentName: string;
  studentRa: string;
  course: string;
  eventTitle: string;
  eventDate: string;
  workload: string;
  speaker: string;
  institution: string;
}

export interface CertificateView {
  id: Uuid;
  eventId: Uuid;
  attendanceId: Uuid;
  verificationCode: string;
  payloadSnapshot: CertificateSnapshot;
  issuedAt: IsoDateTime;
  revokedAt: IsoDateTime | null;
}

export interface CertificateListItem {
  id: Uuid;
  eventId: Uuid;
  verificationCode: string;
  eventTitle: string;
  eventDate: string;
  workload: string;
  issuedAt: IsoDateTime;
  revokedAt: IsoDateTime | null;
}

export interface CertificateVerificationValid {
  valid: true;
  code: string;
  studentName: string;
  eventTitle: string;
  eventDate: string;
  workload: string;
  issuedAt: IsoDateTime;
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

export interface ApiError {
  statusCode: 400 | 401 | 403 | 404 | 409 | 429 | 500;
  message: string;
  error: string;
  code?: string;
}
