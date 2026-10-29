import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaClient, Student } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../database/prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { CertificateService } from '../certificate/certificate.service';
import { PdfGeneratorService } from '../certificate/pdf-generator.service';
import { AttendanceService } from './attendance.service';
import { AttendanceQrReferenceService } from './attendance-qr-reference.service';
import { OfflineAttendanceService } from './offline-attendance.service';
import { OfflineAttendanceController } from './offline-attendance.controller';
import { loadAuthSecrets } from '../auth/auth.config';

interface TestBody {
  expiresAt: string;
  code: string;
  status: string;
  result: { code?: string; status?: string };
  receipts: unknown[];
  missingRequestIds: string[];
}
const bodyOf = (response: { body: unknown }): TestBody =>
  response.body as TestBody;

const url = process.env.OFFLINE_STUDENT_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
integration('Student offline presence: real HTTP and PostgreSQL', () => {
  let db: PrismaClient;
  let app: INestApplication;
  let jwt: JwtService;
  let certificates: CertificateService;
  let student: Student;
  let token: string;
  let sessionCookie: string;
  let reference: string;
  let eventId: string;
  let checkpointId: string;
  const origin = 'http://localhost:5173';
  const post = (route: string, body: object = {}, credential = sessionCookie) =>
    request(app.getHttpServer() as Server)
      .post('/attendances/offline/' + route)
      .set('Origin', origin)
      .set('Cookie', credential || '')
      .send(body);
  const payload = () => ({
    requestId: randomUUID(),
    accountId: student.accountId,
    reference,
    scannedAt: new Date(Date.now() - 60000).toISOString(),
  });
  const prepare = (bearer = token, source = origin, oldCookie = '') =>
    request(app.getHttpServer() as Server)
      .post('/attendances/offline/session')
      .set('Origin', source)
      .set('Cookie', oldCookie)
      .auth(bearer, { type: 'bearer' })
      .send({});

  beforeAll(async () => {
    const target = new URL(url!);
    if (
      target.hostname !== '127.0.0.1' ||
      !target.pathname.startsWith('/disposable_offline_student_')
    )
      throw new Error('Only dedicated local disposable database allowed');
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    // A transaction must never acquire a second connection from the same pool.
    db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: url,
        max: 1,
        connectionTimeoutMillis: 1000,
      }),
    });
    certificates = new CertificateService(
      db as unknown as PrismaService,
      {} as PdfGeneratorService,
    );
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: process.env.JWT_SECRET })],
      controllers: [OfflineAttendanceController],
      providers: [
        AuthGuard,
        AttendanceService,
        AttendanceQrReferenceService,
        OfflineAttendanceService,
        { provide: PrismaService, useValue: db },
        { provide: CertificateService, useValue: certificates },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    jwt = module.get(JwtService);
  });
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
  });
  beforeEach(async () => {
    student = await db.student.create({
      data: {
        ra: randomUUID(),
        name: 'Offline Test Student',
        course: 'ADS',
        status: 'ativo',
        email: randomUUID() + '@example.test',
        admission: '2026',
        dueDate: new Date('2027-01-01'),
        password: randomBytes(24).toString('hex'),
      },
    });
    token = await jwt.signAsync(
      { sub: student.ra, accountId: student.accountId, role: 'student' },
      { expiresIn: '2h' },
    );
    const event = await db.event.create({
      data: {
        title: 'Offline Test Event',
        speaker: 'Test Speaker',
        location: 'Test Auditorium',
        startsAt: new Date(Date.now() - 3600000),
        endsAt: new Date(Date.now() + 3600000),
        workloadMinutes: 60,
        status: 'IN_PROGRESS',
        locationEnabled: false,
        attendanceMode: 'FINAL_ONLY',
        checkpoints: {
          create: {
            type: 'CHECK_OUT',
            isOpen: true,
            version: 1,
            closesAt: new Date(Date.now() + 3600000),
          },
        },
      },
      include: { checkpoints: true },
    });
    eventId = event.id;
    checkpointId = event.checkpoints[0].id;
    const qrToken = await jwt.signAsync(
      {
        eventId,
        checkpoint: 'CHECK_OUT',
        checkpointVersion: 1,
        jti: randomUUID(),
      },
      { secret: loadAuthSecrets().attendanceQrSecret, expiresIn: '1h' },
    );
    const refs = new AttendanceQrReferenceService(
      db as unknown as PrismaService,
    );
    reference = (
      await refs.createReference({
        checkpointId,
        checkpointVersion: 1,
        jwtToken: qrToken,
        expiresAt: new Date(Date.now() + 3600000),
      })
    ).reference;
    const response = await prepare();
    expect(response.status).toBe(200);
    sessionCookie = (
      response.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
  });

  it('prepares HttpOnly strict scoped session, opaque cookie hash and bounded expiry', async () => {
    const short = await jwt.signAsync(
      { sub: student.ra, accountId: student.accountId, role: 'student' },
      { expiresIn: 120 },
    );
    const response = await prepare(short);
    const header = (response.headers['set-cookie'] as unknown as string[])[0];
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/SameSite=Strict/);
    expect(header).toContain('Path=/api/attendances/offline');
    expect(response.body).toEqual({
      accountId: student.accountId,
      expiresAt: expect.any(String) as unknown,
    });
    expect(new Date(bodyOf(response).expiresAt).getTime()).toBeLessThanOrEqual(
      Date.now() + 120000,
    );
    const raw = header.split(';')[0].split('=')[1];
    expect(
      await db.studentOfflineSession.findUnique({ where: { tokenHash: raw } }),
    ).toBeNull();
    const long = await jwt.signAsync(
      { sub: student.ra, accountId: student.accountId, role: 'student' },
      { expiresIn: '30d' },
    );
    expect(
      new Date(bodyOf(await prepare(long)).expiresAt).getTime(),
    ).toBeLessThanOrEqual(Date.now() + 86400000);
  });
  it('requires valid student Bearer with exp and current account identity', async () => {
    expect((await prepare('invalid')).status).toBe(401);
    const secretary = await jwt.signAsync(
      { sub: 1, role: 'secretary' },
      { expiresIn: '1h' },
    );
    expect((await prepare(secretary)).status).toBe(401);
    const noExp = await jwt.signAsync({
      sub: student.ra,
      accountId: student.accountId,
      role: 'student',
    });
    expect((await prepare(noExp)).status).toBe(401);
    const wrong = await jwt.signAsync(
      { sub: student.ra, accountId: randomUUID(), role: 'student' },
      { expiresIn: '1h' },
    );
    expect((await prepare(wrong)).status).toBe(401);
  });
  it('rejects missing/untrusted origins and binds session to original origin', async () => {
    expect((await prepare(token, 'https://attacker.example')).status).toBe(403);
    expect(
      (
        await request(app.getHttpServer() as Server)
          .post('/attendances/offline/submit')
          .set('Cookie', sessionCookie)
          .send(payload())
      ).status,
    ).toBe(403);
    expect(
      bodyOf(
        await post('submit', payload()).set('Origin', 'http://localhost:5174'),
      ).code,
    ).toBe('ORIGIN_MISMATCH');
  });
  it('does not accept the scoped cookie as a general JWT and requires cookie for submit', async () => {
    expect(
      (await post('submit', payload(), '').auth(token, { type: 'bearer' }))
        .status,
    ).toBe(401);
    expect((await prepare(sessionCookie.split('=')[1])).status).toBe(401);
  });
  it('commits attendance, certificate, pending artifact and receipt; client timestamp is only declared', async () => {
    const body = payload();
    const response = await post('submit', body);
    expect(response.status).toBe(200);
    expect(bodyOf(response).status).toBe('confirmed');
    expect(bodyOf(response).result).toMatchObject({
      success: true,
      status: 'CONFIRMED',
    });
    const attendance = await db.attendance.findFirstOrThrow({
      where: { eventId, studentAccountId: student.accountId },
      include: { certificate: { include: { artifact: true } } },
    });
    expect(attendance.checkOutAt!.getTime()).toBeGreaterThan(
      new Date(body.scannedAt).getTime(),
    );
    expect(attendance.certificate?.artifact?.state).toBe('PENDING_RENDER');
    expect(
      await db.studentOfflineReceipt.count({
        where: { requestId: body.requestId },
      }),
    ).toBe(1);
  });
  it('ten concurrent submissions complete with a single-connection pool', async () => {
    const bodies = Array.from({ length: 10 }, payload);
    const responses = await Promise.all(
      bodies.map((body) => post('submit', body).timeout({ deadline: 5000 })),
    );
    responses.forEach((response) => expect(response.status).toBe(200));
    expect(
      await db.studentOfflineReceipt.count({
        where: { requestId: { in: bodies.map((body) => body.requestId) } },
      }),
    ).toBe(10);
    expect(await db.attendance.count({ where: { eventId } })).toBe(1);
    expect(await db.certificate.count({ where: { eventId } })).toBe(1);
  });
  it('concurrent exact replay yields one attendance/certificate/receipt and identical response', async () => {
    const body = payload();
    const responses = await Promise.all([
      post('submit', body),
      post('submit', body),
      post('submit', body),
    ]);
    responses.forEach((r) => expect(r.status).toBe(200));
    expect(responses[0].body).toEqual(responses[1].body);
    expect(responses[1].body).toEqual(responses[2].body);
    expect(await db.attendance.count({ where: { eventId } })).toBe(1);
    expect(await db.certificate.count({ where: { eventId } })).toBe(1);
    expect(
      await db.studentOfflineReceipt.count({
        where: { requestId: body.requestId },
      }),
    ).toBe(1);
  });
  it('recovers response after closed/renewed QR, and rejects changed payload for same ID', async () => {
    const body = payload();
    const original = await post('submit', body);
    await db.eventCheckpoint.update({
      where: { id: checkpointId },
      data: { isOpen: false, version: 2 },
    });
    expect((await post('submit', body)).body).toEqual(original.body);
    const status = await post('status', {
      accountId: student.accountId,
      requestIds: [body.requestId, randomUUID()],
    });
    expect(bodyOf(status).receipts).toEqual([original.body]);
    expect(bodyOf(status).missingRequestIds).toHaveLength(1);
    expect(
      bodyOf(
        await post('submit', { ...body, scannedAt: new Date().toISOString() }),
      ).code,
    ).toBe('REQUEST_ID_REUSED');
  });
  it('preserves duplicate domain semantics without issuing another certificate', async () => {
    expect((await post('submit', payload())).status).toBe(200);
    const response = await post('submit', payload());
    expect(bodyOf(response).result.code).toBe('ALREADY_CHECKED_OUT');
    expect(bodyOf(response).status).toBe('confirmed');
    expect(await db.certificate.count({ where: { eventId } })).toBe(1);
  });
  it.each([
    'closed',
    'version',
    'cancelled',
    'window',
    'reference-expired',
    'location',
  ] as const)(
    'rejects %s without receipts or client-time bypass',
    async (change) => {
      if (change === 'closed')
        await db.eventCheckpoint.update({
          where: { id: checkpointId },
          data: { isOpen: false },
        });
      if (change === 'version')
        await db.eventCheckpoint.update({
          where: { id: checkpointId },
          data: { version: 2 },
        });
      if (change === 'cancelled')
        await db.event.update({
          where: { id: eventId },
          data: { status: 'CANCELLED' },
        });
      if (change === 'window')
        await db.eventCheckpoint.update({
          where: { id: checkpointId },
          data: { closesAt: new Date(Date.now() - 1) },
        });
      if (change === 'reference-expired')
        await db.attendanceQrReference.updateMany({
          where: { checkpointId },
          data: { expiresAt: new Date(Date.now() - 1) },
        });
      if (change === 'location')
        await db.event.update({
          where: { id: eventId },
          data: { locationEnabled: true, geoPolicy: {} },
        });
      const body = payload();
      const response = await post('submit', body);
      expect(response.status).toBe(400);
      if (change === 'location')
        expect(bodyOf(response).code).toBe('LOCATION_REQUIRED');
      expect(
        await db.studentOfflineReceipt.count({
          where: { requestId: body.requestId },
        }),
      ).toBe(0);
      expect(await db.attendance.count({ where: { eventId } })).toBe(0);
    },
  );
  it('rejects account mismatches and does not expose another account receipts', async () => {
    const body = payload();
    await post('submit', body);
    expect(
      bodyOf(await post('submit', { ...payload(), accountId: randomUUID() }))
        .code,
    ).toBe('ACCOUNT_MISMATCH');
    expect(
      (
        await post('status', {
          accountId: randomUUID(),
          requestIds: [body.requestId],
        })
      ).status,
    ).toBe(403);
  });
  it('revokes on logout, rejects expiry and blocks inactive/recreated identity', async () => {
    await post('revoke');
    expect((await post('submit', payload())).status).toBe(401);
    sessionCookie = (await prepare()).headers['set-cookie'][0].split(';')[0];
    await db.studentOfflineSession.updateMany({
      where: { accountId: student.accountId },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect((await post('submit', payload())).status).toBe(401);
    sessionCookie = (await prepare()).headers['set-cookie'][0].split(';')[0];
    await db.student.update({
      where: { ra: student.ra },
      data: { status: 'inativo' },
    });
    expect((await post('submit', payload())).status).toBe(401);
    await db.student.delete({ where: { ra: student.ra } });
    await db.student.create({ data: { ...student, accountId: randomUUID() } });
    expect((await post('submit', payload())).status).toBe(401);
  });
  it('preparing a new session revokes previous cookie', async () => {
    expect((await prepare(token, origin, sessionCookie)).status).toBe(200);
    expect((await post('submit', payload())).status).toBe(401);
  });
  it('rolls back attendance/certificate when receipt persistence fails', async () => {
    const body = payload();
    // Fail the final receipt INSERT after the real attendance/certificate writes.
    await db.$executeRawUnsafe(
      `CREATE FUNCTION offline_receipt_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled receipt failure'; END; $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER offline_receipt_test_failure BEFORE INSERT ON "StudentOfflineReceipt" FOR EACH ROW EXECUTE FUNCTION offline_receipt_test_failure()`,
    );
    try {
      expect((await post('submit', body)).status).toBe(500);
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER offline_receipt_test_failure ON "StudentOfflineReceipt"`,
      );
      await db.$executeRawUnsafe(
        `DROP FUNCTION offline_receipt_test_failure()`,
      );
    }
    expect(await db.attendance.count({ where: { eventId } })).toBe(0);
    expect(await db.certificate.count({ where: { eventId } })).toBe(0);
    expect(
      await db.studentOfflineReceipt.count({
        where: { requestId: body.requestId },
      }),
    ).toBe(0);
    expect((await post('submit', body)).status).toBe(200);
  });
  it('validates all input, rejects extra coordinates/fields, invalid dates and unbounded status', async () => {
    expect(
      (await post('submit', { ...payload(), position: { latitude: 1 } }))
        .status,
    ).toBe(400);
    expect(
      (await post('submit', { ...payload(), scannedAt: 'bad-date' })).status,
    ).toBe(400);
    expect(
      (
        await post('status', {
          accountId: student.accountId,
          requestIds: Array.from({ length: 51 }, () => randomUUID()),
        })
      ).status,
    ).toBe(400);
    expect(
      (await post('status', { accountId: student.accountId, requestIds: [] }))
        .status,
    ).toBe(400);
  });
});
