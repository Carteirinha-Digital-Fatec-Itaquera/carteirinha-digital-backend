/**
 * Contrato de transporte V1 de Funcionários (API de funcionários V1).
 * Tipos portáveis: não importam NestJS, Prisma nem bibliotecas de runtime.
 */

export type Uuid = string;
export type IsoDate = string; // YYYY-MM-DD (America/Sao_Paulo)
export type IsoDateTime = string; // ISO-8601 UTC/offset

export type EmployeeAccountStatus = 'ACTIVE' | 'BLOCKED' | 'ARCHIVED';
export type EmployeeAssignmentEffectiveStatus =
  | 'ACTIVE'
  | 'FUTURE'
  | 'EXPIRED'
  | 'ENDED'
  | 'ARCHIVED';

export type EmployeeValidityKind =
  | 'INDETERMINATE'
  | 'UNTIL_DATE'
  | 'NO_ACTIVE_ASSIGNMENT';

export type EmployeeCredentialReasonCode =
  | 'ACCOUNT_BLOCKED'
  | 'ACCOUNT_ARCHIVED'
  | 'ADMISSION_FUTURE'
  | 'NO_ACTIVE_ASSIGNMENT'
  | 'PHOTO_PENDING'
  | 'PHOTO_REJECTED'
  | 'PHOTO_MISSING';

export type EmployeePhotoReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type EmployeePhotoProcessingState =
  | 'UPLOADING'
  | 'READY'
  | 'FAILED'
  | 'DELETE_PENDING'
  | 'DELETED';

export type EmployeeTokenDeliveryState =
  | 'PENDING'
  | 'ACCEPTED'
  | 'FAILED'
  | 'UNKNOWN';

export type EmployeeImportMode = 'CREATE_ONLY' | 'UPDATE';
export type EmployeeImportBatchState =
  | 'ANALYZED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'CANCELLED'
  | 'EXPIRED';

export type EmployeeImportRowDecision =
  | 'READY_CREATE'
  | 'READY_UPDATE'
  | 'EXISTS'
  | 'INVALID'
  | 'AMBIGUOUS';

export type EmployeeImportRowState =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'STALE';

export type EmployeeApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'IMPORT_SCHEMA_INVALID'
  | 'DATE_RANGE_INVALID'
  | 'TOKEN_INVALID_OR_EXPIRED'
  | 'LOCATION_REQUIRED'
  | 'UNAUTHORIZED'
  | 'SESSION_REVOKED'
  | 'OFFLINE_SESSION_REQUIRED'
  | 'ROLE_FORBIDDEN'
  | 'ACCOUNT_BLOCKED'
  | 'NO_ACTIVE_ASSIGNMENT'
  | 'ORIGIN_MISMATCH'
  | 'EMPLOYEE_NOT_FOUND'
  | 'PHOTO_NOT_FOUND'
  | 'QR_NOT_FOUND'
  | 'EMAIL_ALREADY_EXISTS'
  | 'REGISTRATION_ALREADY_EXISTS'
  | 'VERSION_CONFLICT'
  | 'REQUEST_ID_REUSED'
  | 'PHOTO_VERSION_CONFLICT'
  | 'IMPORT_REVIEW_CHANGED'
  | 'IMPORT_ROW_STALE'
  | 'FILE_TOO_LARGE'
  | 'FILE_TYPE_NOT_ALLOWED'
  | 'RATE_LIMITED'
  | 'STORAGE_UNAVAILABLE';

export interface EmployeeErrorEnvelope {
  statusCode: number;
  code: EmployeeApiErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
  requestId?: string;
  currentVersion?: number;
}

export interface PaginatedListResponse<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

// ==========================================
// 1. Autenticação de Funcionários
// ==========================================

export interface EmployeeLoginRequest {
  email: string;
  password: string;
}

export interface EmployeeLoginResponse {
  token: string;
  mustChangePassword: false;
  profileType: 'employee';
  expiresAt: IsoDateTime;
}

export interface EmployeeRequestAccessRequest {
  email: string;
}

export interface EmployeeGenericAcceptedResponse {
  accepted: true;
  message: string;
}

export interface EmployeeActivateRequest {
  token: string;
  newPassword: string;
}

export interface EmployeeActivateResponse {
  activated: true;
}

export interface EmployeeForgotPasswordRequest {
  email: string;
}

export interface EmployeeResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface EmployeeResetPasswordResponse {
  reset: true;
}

export interface EmployeeChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface EmployeeChangePasswordResponse {
  changed: true;
  reauthenticate: true;
}

export interface EmployeeInviteRequest {
  requestId: Uuid;
  expectedVersion: number;
}

export interface EmployeeInviteResponse {
  requested: true;
  deliveryState: EmployeeTokenDeliveryState;
  requestedAt: IsoDateTime;
}

export interface EmployeeAccessStatusResponse {
  passwordDefined: boolean;
  lastLoginAt: IsoDateTime | null;
  lastAccessRequestAt: IsoDateTime | null;
  lastDeliveryState: EmployeeTokenDeliveryState | null;
}

// ==========================================
// 2. Perfil, Funções, Carteirinha e Fotos
// ==========================================

export interface EmployeeAssignmentView {
  id: Uuid;
  title: string;
  startsOn: IsoDate | null;
  validUntil: IsoDate | null;
  active: boolean;
  effectiveStatus: EmployeeAssignmentEffectiveStatus;
  endedAt?: IsoDateTime | null;
  archivedAt?: IsoDateTime | null;
}

export interface EmployeeCredentialEvaluation {
  valid: boolean;
  accountAllowed: boolean;
  employmentEligible: boolean;
  cardEligible: boolean;
  validityKind: EmployeeValidityKind;
  validUntil: IsoDate | null;
  reasonCode: EmployeeCredentialReasonCode | null;
  checkedAt: IsoDateTime;
}

export interface EmployeeCredentialSummary {
  valid: boolean;
  validityKind: EmployeeValidityKind;
  validUntil: IsoDate | null;
  reasonCode: EmployeeCredentialReasonCode | null;
  checkedAt: IsoDateTime;
}

export interface EmployeePhotoSummary {
  approvedPhotoId: Uuid | null;
  pendingPhotoId: Uuid | null;
  reviewStatus: EmployeePhotoReviewStatus | null;
  reviewReason?: string | null;
}

export interface EmployeeProfileView {
  id: Uuid;
  accountId: Uuid;
  profileType: 'EMPLOYEE';
  name: string;
  socialName: string | null;
  displayName: string;
  email: string;
  registrationNumber: string | null;
  rg: string | null;
  admissionDate: IsoDate;
  accountStatus: EmployeeAccountStatus;
  version: number;
  assignments: EmployeeAssignmentView[];
  credential: EmployeeCredentialSummary;
  photo: EmployeePhotoSummary;
}

export interface EmployeeCredentialCardView {
  id: Uuid;
  accountId: Uuid;
  profileType: 'EMPLOYEE';
  institutionName: string;
  displayName: string;
  registrationNumber: string | null;
  admissionDate: IsoDate;
  activeAssignments: Array<{
    id: Uuid;
    title: string;
    validUntil: IsoDate | null;
  }>;
  credential: EmployeeCredentialSummary;
  approvedPhotoId: Uuid | null;
  approvedPhotoUrl: string | null;
  verificationUrl: string;
  qrcode: string;
  checkedAt: IsoDateTime;
}

export interface EmployeePhotoStatusView {
  approved: {
    id: Uuid;
    reviewStatus: 'APPROVED';
    contentUrl: string;
    reviewedAt: IsoDateTime | null;
  } | null;
  pending: {
    id: Uuid;
    reviewStatus: EmployeePhotoReviewStatus;
    processingState: EmployeePhotoProcessingState;
    contentUrl: string | null;
    reviewReason: string | null;
    createdAt: IsoDateTime;
  } | null;
  version: number;
}

export interface EmployeePhotoUploadResponse {
  photoId: Uuid;
  reviewStatus: 'PENDING';
  processingState: 'READY';
  version: number;
}

export interface EmployeePhotoReviewRequest {
  expectedVersion: number;
  approved: boolean;
  reason?: string;
}

export interface EmployeePhotoRemoveRequest {
  requestId?: Uuid;
  expectedVersion: number;
  reason?: string;
}

export interface PendingEmployeePhotoItem {
  photoId: Uuid;
  employeeId: Uuid;
  employeeName: string;
  displayName: string;
  registrationNumber: string | null;
  employeeVersion: number;
  createdAt: IsoDateTime;
  contentUrl: string;
}

// ==========================================
// 3. Gestão Administrativa de Pessoas e Funções
// ==========================================

export interface EmployeeListItemView {
  id: Uuid;
  accountId: Uuid;
  name: string;
  socialName: string | null;
  displayName: string;
  email: string;
  registrationNumber: string | null;
  admissionDate: IsoDate;
  accountStatus: EmployeeAccountStatus;
  version: number;
  activeAssignmentsCount: number;
  assignmentTitles: string[];
  credential: EmployeeCredentialSummary;
  photo: EmployeePhotoSummary;
  archivedAt: IsoDateTime | null;
}

export interface CreateEmployeeAssignmentInput {
  title: string;
  startsOn?: IsoDate | null;
  validUntil?: IsoDate | null;
  active?: boolean;
}

export interface CreateEmployeeRequest {
  requestId: Uuid;
  name: string;
  socialName?: string | null;
  email: string;
  registrationNumber?: string | null;
  rg?: string | null;
  admissionDate: IsoDate;
  assignments: CreateEmployeeAssignmentInput[];
}

export interface UpdateEmployeeRequest {
  expectedVersion: number;
  reason: string;
  name?: string;
  socialName?: string | null;
  email?: string;
  registrationNumber?: string | null;
  rg?: string | null;
  admissionDate?: IsoDate;
}

export interface UpdateEmployeeStatusRequest {
  expectedVersion: number;
  reason: string;
  status: 'ACTIVE' | 'BLOCKED';
}

export interface EmployeeReasonMutationRequest {
  expectedVersion: number;
  reason: string;
}

export interface RenewEmployeeQrRequest {
  requestId: Uuid;
  expectedVersion: number;
  reason: string;
}

export interface RenewEmployeeQrResponse {
  id: Uuid;
  version: number;
  qrcode: string;
  verificationUrl: string;
}

export interface CreateAssignmentRequest {
  expectedVersion: number;
  reason: string;
  title: string;
  startsOn?: IsoDate | null;
  validUntil?: IsoDate | null;
  active?: boolean;
}

export interface UpdateAssignmentRequest {
  expectedVersion: number;
  reason: string;
  title?: string;
  startsOn?: IsoDate | null;
  validUntil?: IsoDate | null;
  active?: boolean;
}

export interface EmployeeAssignmentMutationResponse {
  employeeId: Uuid;
  version: number;
  assignment: EmployeeAssignmentView;
  credential: EmployeeCredentialSummary;
}

export interface EmployeeAuditItemView {
  id: Uuid;
  actorRole: 'employee' | 'secretary' | 'system';
  actorId: string;
  action: string;
  requestId: string;
  reason: string | null;
  changedFields: Record<string, unknown>;
  sourceImportBatchId: Uuid | null;
  createdAt: IsoDateTime;
}

export interface EmployeeHistoryView {
  employee: {
    id: Uuid;
    accountId: Uuid;
    displayName: string;
    registrationNumber: string | null;
    accountStatus: EmployeeAccountStatus;
  };
  participations: Array<{
    participantId: Uuid;
    eventId: Uuid;
    eventTitle: string;
    eventStartsAt: IsoDateTime;
    eventEndsAt: IsoDateTime;
    role: string;
    attendanceStatus: string | null;
    checkInAt: IsoDateTime | null;
    checkOutAt: IsoDateTime | null;
    certificate: {
      id: Uuid;
      version: number;
      verificationCode: string;
      issuedAt: IsoDateTime;
      revokedAt: IsoDateTime | null;
    } | null;
  }>;
}

// ==========================================
// 4. Importação CSV / XLSX
// ==========================================

export interface EmployeeImportTemplateMetadata {
  schemaVersion: '1.0';
  sheetName: 'Funcionarios';
  maxFileSizeBytes: number;
  maxRows: number;
  columns: string[];
}

export interface EmployeeImportBatchCounts {
  totalRows: number;
  totalGroups: number;
  readyCreate: number;
  readyUpdate: number;
  exists: number;
  invalid: number;
  ambiguous: number;
  succeeded: number;
  failed: number;
  stale: number;
  cancelled: number;
}

export interface EmployeeImportBatchView {
  batchId: Uuid;
  schemaVersion: string;
  mode: EmployeeImportMode;
  state: EmployeeImportBatchState;
  revision: number;
  reviewDigest: string;
  counts: EmployeeImportBatchCounts;
  expiresAt: IsoDateTime;
  confirmedAt: IsoDateTime | null;
  finishedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface EmployeeImportRowView {
  id: Uuid;
  rowNumber: number;
  groupId: Uuid;
  decision: EmployeeImportRowDecision;
  state: EmployeeImportRowState;
  employeeId: Uuid | null;
  expectedEmployeeVersion: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  input: {
    name?: string | null;
    socialName?: string | null;
    email?: string | null;
    registrationNumber?: string | null;
    hasRg?: boolean;
    admissionDate?: string | null;
    assignmentTitle?: string | null;
    startsOn?: string | null;
    validUntil?: string | null;
    active?: boolean | null;
  };
}

export interface ConfirmEmployeeImportRequest {
  requestId: Uuid;
  revision: number;
  reviewDigest: string;
  selectedGroupIds: Uuid[];
}

export interface CancelEmployeeImportRequest {
  requestId: Uuid;
  reason: string;
}

export interface ReprocessEmployeeImportRequest {
  requestId: Uuid;
  groupIds: Uuid[];
}

// ==========================================
// 5. Validação Pública & Informações Institucionais
// ==========================================

export interface PublicEmployeeVerificationValid {
  valid: true;
  profileType: 'EMPLOYEE';
  displayName: string;
  activeAssignments: Array<{ title: string }>;
  validityKind: 'INDETERMINATE' | 'UNTIL_DATE';
  validUntil: IsoDate | null;
  photoUrl: string | null;
  checkedAt: IsoDateTime;
}

export interface PublicEmployeeVerificationInvalid {
  valid: false;
  profileType: 'EMPLOYEE';
  reasonCode: EmployeeCredentialReasonCode;
  checkedAt: IsoDateTime;
}

export type PublicEmployeeVerificationResponse =
  | PublicEmployeeVerificationValid
  | PublicEmployeeVerificationInvalid;

export interface PublicInstitutionInfoResponse {
  name: string;
  shortName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}

// ==========================================
// 6. Presença Offline de Funcionários
// ==========================================

export interface EmployeeOfflineSessionResponse {
  accountId: Uuid;
  expiresAt: IsoDateTime;
}

export interface EmployeeOfflineSubmitRequest {
  requestId: Uuid;
  accountId: Uuid;
  reference: string;
  scannedAt: IsoDateTime;
}

export interface EmployeeOfflineReceiptView {
  requestId: Uuid;
  reference: string;
  scannedAt: IsoDateTime;
  receivedAt: IsoDateTime;
  result: unknown;
}

export interface EmployeeOfflineStatusRequest {
  accountId: Uuid;
  requestIds: Uuid[];
}

export interface EmployeeOfflineStatusResponse {
  receipts: EmployeeOfflineReceiptView[];
}

// ==========================================
// 7. Extensões de Eventos, Certificados e Suporte
// ==========================================

export interface ManualEmployeeCertificateRequest {
  requestId: Uuid;
  identityType: 'EMPLOYEE';
  employeeId: Uuid;
  expectedAccountId: Uuid;
  participationConfirmed: true;
  reason: string;
}

export interface CertificateRecipientEmployee {
  type: 'EMPLOYEE';
  displayName: string;
  registrationNumber: string | null;
}
