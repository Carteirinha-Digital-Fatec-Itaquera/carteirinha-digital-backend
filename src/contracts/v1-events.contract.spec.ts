import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AttendanceQrResponse,
  AttendanceScanDuplicate,
  AttendanceScanRequest,
  AttendanceScanResponse,
  AttendanceScanSuccess,
  AttendanceSummary,
  AttendanceView,
  CertificateListItem,
  CertificateVerificationRevoked,
  CertificateVerificationValid,
  CertificateView,
  CheckpointMutationResponse,
  CreateEventRequest,
  EventView,
  MyAttendanceView,
} from './v1-events.types';

const contractDir = join(__dirname, '..', '..', 'docs', 'contracts');
const fixture = <T>(name: string): T => {
  const parsed: unknown = JSON.parse(
    readFileSync(join(contractDir, 'fixtures', name), 'utf8'),
  );
  return parsed as T;
};

interface EventFixtures {
  createRequest: CreateEventRequest;
  events: EventView[];
  checkpointOpenResponse: CheckpointMutationResponse;
  qrResponse: AttendanceQrResponse;
  qrClaimsExample: QrClaims;
}

interface AttendanceFixtures {
  scanRequest: AttendanceScanRequest;
  scanSuccess: AttendanceScanSuccess;
  scanDuplicate: AttendanceScanDuplicate;
  attendances: AttendanceView[];
  myAttendances: MyAttendanceView[];
  summary: AttendanceSummary;
}

interface CertificateFixtures {
  certificates: CertificateListItem[];
  certificateDetails: CertificateView;
  verificationValid: CertificateVerificationValid;
  verificationRevoked: CertificateVerificationRevoked;
}

interface QrClaims {
  eventId: string;
  checkpoint: string;
  checkpointVersion: number;
  jti: string;
  iat: number;
  exp: number;
}

type FieldKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'nullableString';

function expectFields(value: unknown, fields: Record<string, FieldKind>): void {
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
  expect(typeof value).toBe('object');
  const record = value as Record<string, unknown>;
  for (const [key, kind] of Object.entries(fields)) {
    expect(record).toHaveProperty(key);
    const field = record[key];
    if (kind === 'nullableString' && field === null) continue;
    if (kind === 'array') {
      expect(Array.isArray(field)).toBe(true);
    } else {
      expect(typeof field).toBe(kind === 'nullableString' ? 'string' : kind);
    }
  }
}

describe('Contrato V1 de eventos', () => {
  const events = fixture<EventFixtures>('events.mock.json');
  const attendance = fixture<AttendanceFixtures>('attendance.mock.json');
  const certificates = fixture<CertificateFixtures>('certificates.mock.json');

  it('valida campos obrigatórios e tipos dos três exemplos JSON', () => {
    expectFields(events.createRequest, {
      title: 'string',
      speaker: 'string',
      location: 'string',
      startsAt: 'string',
      endsAt: 'string',
      workloadMinutes: 'number',
    });
    expectFields(events.events[0], {
      id: 'string',
      title: 'string',
      description: 'nullableString',
      speaker: 'string',
      location: 'string',
      startsAt: 'string',
      endsAt: 'string',
      workloadMinutes: 'number',
      status: 'string',
      certificateEnabled: 'boolean',
      checkpoints: 'array',
      createdAt: 'string',
      updatedAt: 'string',
    });
    for (const checkpoint of events.events[0].checkpoints) {
      expectFields(checkpoint, {
        id: 'string',
        eventId: 'string',
        type: 'string',
        isOpen: 'boolean',
        version: 'number',
        openedAt: 'nullableString',
        closedAt: 'nullableString',
      });
    }
    expectFields(events.checkpointOpenResponse, {
      eventId: 'string',
      type: 'string',
      isOpen: 'boolean',
      version: 'number',
      openedAt: 'nullableString',
      closedAt: 'nullableString',
    });
    expectFields(events.qrResponse, {
      qrToken: 'string',
      expiresInSeconds: 'number',
      expiresAt: 'string',
      checkpointVersion: 'number',
    });
    expectFields(events.qrClaimsExample, {
      eventId: 'string',
      checkpoint: 'string',
      checkpointVersion: 'number',
      jti: 'string',
      iat: 'number',
      exp: 'number',
    });
    expectFields(attendance.scanRequest, { qrToken: 'string' });
    expectFields(attendance.scanSuccess, {
      success: 'boolean',
      type: 'string',
      eventTitle: 'string',
      timestamp: 'string',
      status: 'string',
      message: 'string',
    });
    expectFields(attendance.scanDuplicate, {
      success: 'boolean',
      code: 'string',
      message: 'string',
      timestamp: 'string',
    });
    for (const presence of attendance.attendances) {
      expectFields(presence, {
        id: 'string',
        eventId: 'string',
        eventTitle: 'string',
        studentRa: 'string',
        studentName: 'string',
        studentCourse: 'string',
        checkInAt: 'nullableString',
        checkOutAt: 'nullableString',
        status: 'string',
      });
    }
    for (const presence of attendance.myAttendances) {
      expectFields(presence, {
        id: 'string',
        eventId: 'string',
        eventTitle: 'string',
        checkInAt: 'nullableString',
        checkOutAt: 'nullableString',
        status: 'string',
      });
    }
    expectFields(attendance.summary, {
      checkedInCount: 'number',
      checkedOutCount: 'number',
      confirmedCount: 'number',
    });
    expectFields(certificates.certificateDetails, {
      id: 'string',
      eventId: 'string',
      attendanceId: 'string',
      verificationCode: 'string',
      payloadSnapshot: 'object',
      issuedAt: 'string',
      revokedAt: 'nullableString',
    });
    expectFields(certificates.certificateDetails.payloadSnapshot, {
      studentName: 'string',
      studentRa: 'string',
      course: 'string',
      eventTitle: 'string',
      eventDate: 'string',
      workload: 'string',
      speaker: 'string',
      institution: 'string',
    });
    for (const certificate of certificates.certificates) {
      expectFields(certificate, {
        id: 'string',
        eventId: 'string',
        verificationCode: 'string',
        eventTitle: 'string',
        eventDate: 'string',
        workload: 'string',
        issuedAt: 'string',
        revokedAt: 'nullableString',
      });
    }
    expectFields(certificates.verificationValid, {
      valid: 'boolean',
      code: 'string',
      studentName: 'string',
      eventTitle: 'string',
      eventDate: 'string',
      workload: 'string',
      issuedAt: 'string',
      institution: 'string',
    });
    expectFields(certificates.verificationRevoked, {
      valid: 'boolean',
      code: 'string',
      revoked: 'boolean',
      message: 'string',
    });
  });

  it('mantém os mesmos IDs e snapshots em evento, presença e certificado', () => {
    const event: EventView = events.events[0];
    const presence: AttendanceView = attendance.attendances[0];
    const certificate: CertificateView = certificates.certificateDetails;

    expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
    expect(Date.parse(event.endsAt)).toBeGreaterThan(
      Date.parse(event.startsAt),
    );
    expect(event.checkpoints.map((item) => item.type).sort()).toEqual([
      'CHECK_IN',
      'CHECK_OUT',
    ]);
    expect(event.checkpoints.every((item) => item.eventId === event.id)).toBe(
      true,
    );
    expect(
      event.checkpoints.every((item) => !item.isOpen && item.version === 1),
    ).toBe(true);
    expect(presence.eventId).toBe(event.id);
    expect(presence.eventTitle).toBe(event.title);
    expect(presence.status).toBe('CONFIRMED');
    expect(Date.parse(presence.checkInAt!)).toBeLessThan(
      Date.parse(presence.checkOutAt!),
    );
    expect(certificate.eventId).toBe(event.id);
    expect(certificate.attendanceId).toBe(presence.id);
    expect(certificate.payloadSnapshot.studentRa).toBe(presence.studentRa);
    expect(certificate.payloadSnapshot.studentName).toBe(presence.studentName);
    expect(certificate.payloadSnapshot.course).toBe(presence.studentCourse);
    expect(certificate.payloadSnapshot.eventTitle).toBe(event.title);
    expect(Date.parse(certificate.issuedAt)).toBeGreaterThan(
      Date.parse(presence.checkOutAt!),
    );
    expect(certificates.certificates[0].verificationCode).toBe(
      certificate.verificationCode,
    );
  });

  it('usa um QR fictício coerente, válido no momento do scan e sem dados pessoais', () => {
    const qr = events.qrResponse;
    const token: string = qr.qrToken;
    expect(token).toBe('JWT_PRESENCA_FICTICIO');
    const claims = events.qrClaimsExample;

    expect(Object.keys(claims).sort()).toEqual(
      [
        'eventId',
        'checkpoint',
        'checkpointVersion',
        'jti',
        'iat',
        'exp',
      ].sort(),
    );
    expect(claims.eventId).toBe(events.events[0].id);
    expect(claims.checkpoint).toBe(events.checkpointOpenResponse.type);
    expect(claims.checkpointVersion).toBe(qr.checkpointVersion);
    expect(claims.exp - claims.iat).toBe(qr.expiresInSeconds);
    expect(new Date(claims.exp * 1000).toISOString()).toBe(qr.expiresAt);
    expect(attendance.scanRequest.qrToken).toBe(token);
    const scanTime = Date.parse(attendance.scanSuccess.timestamp);
    expect(scanTime).toBeGreaterThanOrEqual(claims.iat * 1000);
    expect(scanTime).toBeLessThan(claims.exp * 1000);
    expect(attendance.attendances[0].checkInAt).toBe(
      attendance.scanSuccess.timestamp,
    );
  });

  it('documenta resposta de duplicata e verificação pública mínima', () => {
    const scan: AttendanceScanResponse = attendance.scanSuccess;
    const duplicate: AttendanceScanResponse = attendance.scanDuplicate;
    expect(scan.success).toBe(true);
    expect(duplicate.success).toBe(false);
    expect(attendance.summary).toEqual({
      checkedInCount: 1,
      checkedOutCount: 1,
      confirmedCount: 1,
    });
    expect(attendance.myAttendances[0]).not.toHaveProperty('studentRa');
    expect(attendance.myAttendances[0]).not.toHaveProperty('studentName');

    const valid = certificates.verificationValid;
    const revoked = certificates.verificationRevoked;
    expect(valid.code).toBe(certificates.certificateDetails.verificationCode);
    expect(valid.studentName).toBe(
      certificates.certificateDetails.payloadSnapshot.studentName,
    );
    expect(Object.keys(valid).sort()).toEqual(
      [
        'valid',
        'code',
        'studentName',
        'eventTitle',
        'eventDate',
        'workload',
        'issuedAt',
        'institution',
      ].sort(),
    );
    expect(Object.keys(revoked).sort()).toEqual(
      ['valid', 'code', 'revoked', 'message'].sort(),
    );
    expect(revoked.valid).toBe(false);
  });

  it('mantém exatamente 15 rotas únicas e uma seção de detalhes para cada uma', () => {
    const spec = readFileSync(join(contractDir, 'v1-events-spec.md'), 'utf8');
    const routes = [
      ...spec.matchAll(/^\|\s*(\d+)\s*\|\s*`([A-Z]+) ([^`]+)`\s*\|/gm),
    ];
    expect(routes).toHaveLength(16);
    expect(routes.map((match) => Number(match[1]))).toEqual(
      Array.from({ length: 16 }, (_, index) => index + 1),
    );
    expect(new Set(routes.map((match) => `${match[2]} ${match[3]}`)).size).toBe(
      16,
    );
    for (const route of routes) {
      expect(spec).toContain(`### ${route[1]}. ${route[2]} ${route[3]}`);
    }
  });
});
