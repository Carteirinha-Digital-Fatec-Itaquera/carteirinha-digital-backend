// Banco dedicado apenas: nunca usa DIRECT_URL implicitamente.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import type { Server } from 'http';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../database/prisma.service';
import { EventController } from '../event/event.controller';
import { EventService } from '../event/event.service';
import { CheckpointService } from '../event/checkpoint.service';
import { QrTokenService } from '../event/qr-token.service';
import {
  AttendanceController,
  EventAttendanceController,
} from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceQrReferenceService } from './attendance-qr-reference.service';
import { CertificateService } from '../certificate/certificate.service';
import { PdfGeneratorService } from '../certificate/pdf-generator.service';

const url = process.env.ATTENDANCE_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
integration('Attendance with real PostgreSQL and backend QR', () => {
  let prisma: PrismaClient;
  let app: INestApplication;
  let jwt: JwtService;
  let eventId: string;
  let ra: string;
  let accountId: string;
  let studentToken: string;
  let secretaryToken: string;
  let secretaryId: number;
  const http = () => request(app.getHttpServer() as Server);
  const scan = (qrToken: string, login = studentToken) =>
    http()
      .post('/attendances/scan')
      .auth(login, { type: 'bearer' })
      .send({ qrToken });
  const checkpoint = (kind: string, action: string) =>
    http()
      .post(`/events/${eventId}/checkpoints/${kind}/${action}`)
      .auth(secretaryToken, { type: 'bearer' });
  const qr = async (kind: string): Promise<string> => {
    const result = await http()
      .get(`/events/${eventId}/checkpoints/${kind}/qr`)
      .auth(secretaryToken, { type: 'bearer' })
      .expect(200);
    return (result.body as { qrToken: string }).qrToken;
  };
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !target.pathname.startsWith('/issue26_')
    )
      throw new Error('Use a local dedicated issue26_* database');
    process.env.JWT_SECRET = 'integration-login-secret';
    process.env.ATTENDANCE_QR_SECRET = 'integration-qr-secret';
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
    });
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: process.env.JWT_SECRET })],
      controllers: [
        AttendanceController,
        EventAttendanceController,
        EventController,
      ],
      providers: [
        AuthGuard,
        RolesGuard,
        AttendanceService,
        AttendanceQrReferenceService,
        CertificateService,
        PdfGeneratorService,
        EventService,
        CheckpointService,
        QrTokenService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
    jwt = module.get(JwtService);
    const secretary = await prisma.secretary.create({
      data: {
        name: 'Teste #26',
        email: randomUUID() + '@example.test',
        password: 'unused',
        birthDate: new Date('1990-01-01'),
        dueDate: new Date('2030-01-01'),
      },
    });
    secretaryId = secretary.id;
    secretaryToken = jwt.sign({ sub: secretary.id, role: 'secretary' });
  });
  beforeEach(async () => {
    ra = 'issue26-' + randomUUID();
    const student = await prisma.student.create({
      data: {
        ra,
        name: 'Aluno original',
        course: 'DSM',
        status: 'Ativo',
        admission: '20261',
        email: randomUUID() + '@example.test',
        password: 'unused',
        dueDate: new Date('2030-01-01'),
      },
    });
    accountId = student.accountId;
    studentToken = jwt.sign({ sub: ra, accountId, role: 'student' });
    const response = await http()
      .post('/events')
      .auth(secretaryToken, { type: 'bearer' })
      .send({
        title: 'Evento integração #26',
        speaker: 'Docente',
        location: 'Auditório',
        startsAt: '2030-01-01T10:00:00Z',
        endsAt: '2030-01-01T12:00:00Z',
        workloadMinutes: 120,
      })
      .expect(201);
    eventId = (response.body as { id: string }).id;
  });
  afterEach(async () => {
    if (eventId) {
      await prisma.certificate.deleteMany({ where: { eventId } });
      await prisma.attendance.deleteMany({ where: { eventId } });
      await prisma.eventCheckpoint.deleteMany({ where: { eventId } });
      await prisma.event.delete({ where: { id: eventId } });
    }
    if (ra) await prisma.student.deleteMany({ where: { ra } });
  });
  afterAll(async () => {
    if (secretaryId)
      await prisma.secretary.delete({ where: { id: secretaryId } });
    await app?.close();
    await prisma?.$disconnect();
  });

  it('persists one entry/exit under concurrent scans; private/public projections and live summary', async () => {
    await checkpoint('check-in', 'open').expect(200);
    const input = await qr('check-in');
    const entries = await Promise.all(
      Array.from({ length: 8 }, () => scan(input)),
    );
    expect(entries.map((x) => x.status)).toEqual(Array(8).fill(200));
    expect(
      entries.filter((x) => (x.body as { success: boolean }).success),
    ).toHaveLength(1);
    expect(
      entries.filter(
        (x) => (x.body as { code?: string }).code === 'ALREADY_CHECKED_IN',
      ),
    ).toHaveLength(7);
    const original = await prisma.attendance.findUniqueOrThrow({
      where: { eventId_studentRa: { eventId, studentRa: ra } },
    });
    expect(original).toMatchObject({
      studentName: 'Aluno original',
      studentCourse: 'DSM',
      studentAccountId: accountId,
      studentRefRa: ra,
    });
    await checkpoint('check-in', 'close').expect(200);
    await scan(input).expect(400);
    await checkpoint('check-out', 'open').expect(200);
    const output = await qr('check-out');
    const exits = await Promise.all(
      Array.from({ length: 8 }, () => scan(output)),
    );
    expect(exits.map((x) => x.status)).toEqual(Array(8).fill(200));
    expect(
      exits.filter((x) => (x.body as { success: boolean }).success),
    ).toHaveLength(1);
    expect(
      exits.filter(
        (x) => (x.body as { code?: string }).code === 'ALREADY_CHECKED_OUT',
      ),
    ).toHaveLength(7);
    const attendance = await prisma.attendance.findUniqueOrThrow({
      where: { id: original.id },
      include: { event: true },
    });
    expect(attendance.checkInAt).toEqual(original.checkInAt);
    expect(attendance.checkOutAt).not.toBeNull();
    expect(
      attendance.status === 'CONFIRMED' && attendance.event.certificateEnabled,
    ).toBe(true);
    expect(await prisma.attendance.count({ where: { eventId } })).toBe(1);
    const mine = await http()
      .get('/attendances/me')
      .auth(studentToken, { type: 'bearer' })
      .expect(200);
    expect(mine.body).toEqual([
      {
        id: original.id,
        eventId,
        eventTitle: attendance.event.title,
        checkInAt: original.checkInAt!.toISOString(),
        checkOutAt: attendance.checkOutAt!.toISOString(),
        status: 'CONFIRMED',
      },
    ]);
    await prisma.student.update({
      where: { ra },
      data: { name: 'Nome alterado', course: 'Outro' },
    });
    const list = await http()
      .get(`/events/${eventId}/attendances`)
      .auth(secretaryToken, { type: 'bearer' })
      .expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({
        studentRa: ra,
        studentName: 'Aluno original',
        studentCourse: 'DSM',
      }),
    ]);
    const summary = await http()
      .get(`/events/${eventId}/attendances/summary`)
      .auth(secretaryToken, { type: 'bearer' })
      .expect(200);
    expect(summary.body).toEqual({
      checkedInCount: 1,
      checkedOutCount: 1,
      confirmedCount: 1,
    });
  });
  it('invalidates closed/reopened versions, expired tokens and requires prior entry', async () => {
    await checkpoint('check-in', 'open').expect(200);
    const old = await qr('check-in');
    await checkpoint('check-in', 'close').expect(200);
    await checkpoint('check-in', 'open').expect(200);
    const mismatch = await scan(old).expect(400);
    expect(mismatch.body).toMatchObject({ code: 'QR_VERSION_MISMATCH' });
    const decoded = jwt.decode<{ checkpointVersion: number }>(
      await qr('check-in'),
    );
    const expired = jwt.sign(
      {
        eventId,
        checkpoint: 'CHECK_IN',
        checkpointVersion: decoded.checkpointVersion,
        jti: randomUUID(),
        iat: 1,
        exp: 2,
      },
      { secret: process.env.ATTENDANCE_QR_SECRET },
    );
    expect((await scan(expired).expect(400)).body).toMatchObject({
      code: 'QR_EXPIRED',
    });
    await checkpoint('check-in', 'close').expect(200);
    await checkpoint('check-out', 'open').expect(200);
    expect((await scan(await qr('check-out')).expect(400)).body).toMatchObject({
      code: 'CHECK_IN_REQUIRED',
    });
    expect(await prisma.attendance.count({ where: { eventId } })).toBe(0);
  });
  it('preserves history after deletion and refuses both old login and reused RA', async () => {
    await checkpoint('check-in', 'open').expect(200);
    await scan(await qr('check-in')).expect(200);
    await prisma.student.delete({ where: { ra } });
    await http()
      .get('/attendances/me')
      .auth(studentToken, { type: 'bearer' })
      .expect(401);
    await prisma.student.create({
      data: {
        ra,
        name: 'Nova conta',
        course: 'Outro',
        status: 'Ativo',
        admission: '20261',
        email: randomUUID() + '@example.test',
        password: 'unused',
        dueDate: new Date('2030-01-01'),
      },
    });
    const replacement = await prisma.student.findUniqueOrThrow({
      where: { ra },
    });
    const newLogin = jwt.sign({
      sub: ra,
      accountId: replacement.accountId,
      role: 'student',
    });
    await scan(await qr('check-in')).expect(401);
    expect(
      (
        await http()
          .get('/attendances/me')
          .auth(newLogin, { type: 'bearer' })
          .expect(200)
      ).body,
    ).toEqual([]);
    expect(
      (await scan(await qr('check-in'), newLogin).expect(409)).body,
    ).toMatchObject({ code: 'RA_REUSE_HISTORY_CONFLICT' });
    const history = await prisma.attendance.findFirstOrThrow({
      where: { eventId },
    });
    expect(history.studentRefRa).toBeNull();
    expect(history.studentAccountId).toBe(accountId);
    expect(history.studentName).toBe('Aluno original');
  });
  it('rechecks expiration after waiting for the per-student database lock', async () => {
    await checkpoint('check-in', 'open').expect(200);
    const generated = jwt.decode<{ checkpointVersion: number }>(
      await qr('check-in'),
    );
    const now = Math.floor(Date.now() / 1000);
    const short = jwt.sign(
      {
        eventId,
        checkpoint: 'CHECK_IN',
        checkpointVersion: generated.checkpointVersion,
        jti: randomUUID(),
        iat: now,
        exp: now + 2,
      },
      { secret: process.env.ATTENDANCE_QR_SECRET },
    );
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([eventId, ra])},0))::text`;
        locked();
        await hold;
      },
      { timeout: 10000 },
    );
    await gate;
    const pending = scan(short).then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 2200));
    release();
    await blocker;
    expect((await pending).body).toMatchObject({ code: 'QR_EXPIRED' });
    expect(await prisma.attendance.count({ where: { eventId } })).toBe(0);
  });
  it('rejects a scan when a concurrent checkpoint closure commits first', async () => {
    await checkpoint('check-in', 'open').expect(200);
    const input = await qr('check-in');
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closing = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "EventCheckpoint" WHERE "eventId" = ${eventId} AND "type" = 'CHECK_IN' FOR UPDATE`;
        locked();
        await hold;
        await tx.eventCheckpoint.update({
          where: { eventId_type: { eventId, type: 'CHECK_IN' } },
          data: {
            isOpen: false,
            closedAt: new Date(),
            version: { increment: 1 },
          },
        });
      },
      { timeout: 10000 },
    );
    await gate;
    const pending = scan(input).then((response) => response);
    try {
      // Observa o scan aguardando um lock real, sem depender de um sleep arbitrário.
      let waiting = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const [state] = await prisma.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
            AND wait_event_type = 'Lock' AND query LIKE '%FOR SHARE%') AS waiting`;
        if (state.waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
    } finally {
      release();
      await closing;
    }
    const result = await pending;
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: 'CHECKPOINT_CLOSED' });
    expect(await prisma.attendance.count({ where: { eventId } })).toBe(0);
  });
  it('records presence when certificates are disabled, without issuing a certificate', async () => {
    await prisma.event.update({
      where: { id: eventId },
      data: { certificateEnabled: false },
    });
    await checkpoint('check-in', 'open').expect(200);
    await scan(await qr('check-in')).expect(200);
    await checkpoint('check-in', 'close').expect(200);
    await checkpoint('check-out', 'open').expect(200);
    await scan(await qr('check-out')).expect(200);
    const attendance = await prisma.attendance.findFirstOrThrow({
      where: { eventId },
      include: { event: true },
    });
    expect(attendance.status).toBe('CONFIRMED');
    expect(attendance.event.certificateEnabled).toBe(false);
    expect(await prisma.certificate.count({ where: { eventId } })).toBe(0);
  });

  it('geração de QR retorna qrUrl curta, serverTime e permite prévia e scan por referência para múltiplos alunos', async () => {
    await checkpoint('check-in', 'open').expect(200);

    const qrResponse = await http()
      .get(`/events/${eventId}/checkpoints/check-in/qr`)
      .auth(secretaryToken, { type: 'bearer' })
      .expect(200);

    expect(qrResponse.body).toHaveProperty('qrUrl');
    expect(qrResponse.body).toHaveProperty('serverTime');
    const qrUrl = (qrResponse.body as { qrUrl: string }).qrUrl;
    expect(qrUrl).toMatch(/\/p\/[A-Za-z0-9_-]{22}$/);
    const reference = qrUrl.split('/p/')[1];

    // 1. Prévia autenticada do aluno: retorna evento sem registrar presença
    const preview = await http()
      .get(`/attendances/qr/${reference}`)
      .auth(studentToken, { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');

    const previewBody = preview.body as {
      event: { id: string };
      checkpoint: { type: string };
    };
    expect(previewBody.event.id).toBe(eventId);
    expect(previewBody.checkpoint.type).toBe('CHECK_IN');
    expect(await prisma.attendance.count({ where: { eventId } })).toBe(0);

    // 2. Confirmação por scan-reference: registra presença
    const scanResult = await http()
      .post('/attendances/scan-reference')
      .auth(studentToken, { type: 'bearer' })
      .send({ qrReference: reference })
      .expect(200);

    expect(scanResult.body).toMatchObject({
      success: true,
      type: 'CHECK_IN',
      status: 'CHECKED_IN',
    });
    expect(
      await prisma.attendance.count({ where: { eventId, studentRa: ra } }),
    ).toBe(1);

    // 3. O mesmo QR deve funcionar para múltiplos alunos (não é consumido globalmente)
    const secondStudentRa = 'issue37-' + randomUUID();
    const secondStudent = await prisma.student.create({
      data: {
        ra: secondStudentRa,
        name: 'Segundo Aluno',
        course: 'DSM',
        status: 'Ativo',
        admission: '20261',
        email: randomUUID() + '@example.test',
        password: 'unused',
        dueDate: new Date('2030-01-01'),
      },
    });
    const secondStudentToken = jwt.sign({
      sub: secondStudentRa,
      accountId: secondStudent.accountId,
      role: 'student',
    });

    const secondScanResult = await http()
      .post('/attendances/scan-reference')
      .auth(secondStudentToken, { type: 'bearer' })
      .send({ qrReference: reference })
      .expect(200);

    expect(secondScanResult.body).toMatchObject({
      success: true,
      type: 'CHECK_IN',
      status: 'CHECKED_IN',
    });
    expect(
      await prisma.attendance.count({
        where: { eventId, studentRa: secondStudentRa },
      }),
    ).toBe(1);
  });

  it('expiredReferenceCannotConfirm: referência de checkpoint fechado ou versão obsoleta é recusada', async () => {
    // 1. Abre check-in e gera QR
    await checkpoint('check-in', 'open').expect(200);
    const qrResponse = await http()
      .get(`/events/${eventId}/checkpoints/check-in/qr`)
      .auth(secretaryToken, { type: 'bearer' })
      .expect(200);
    const reference = (qrResponse.body as { qrUrl: string }).qrUrl.split(
      '/p/',
    )[1];

    // 2. Fecha o checkpoint
    await checkpoint('check-in', 'close').expect(200);

    // 3. Tenta confirmar com a referência gerada antes do fechamento
    const scanResult = await http()
      .post('/attendances/scan-reference')
      .auth(studentToken, { type: 'bearer' })
      .send({ qrReference: reference });

    expect(scanResult.status).toBe(400);
    expect(scanResult.body).toMatchObject({ code: 'CHECKPOINT_CLOSED' });

    // Referência inexistente/desconhecida também é rejeitada
    const nonExistentRef = 'nonExistentRef12345678';
    const invalidResult = await http()
      .post('/attendances/scan-reference')
      .auth(studentToken, { type: 'bearer' })
      .send({ qrReference: nonExistentRef });
    expect(invalidResult.status).toBe(400);
    expect(invalidResult.body).toMatchObject({ code: 'EXPIRED_OR_INVALID_QR' });
  });

  it('doubleConfirmIsIdempotent: duplo toque com a mesma referência não duplica presença', async () => {
    // Aluno novo para isolar o teste
    const studentRa = 'idempotent-' + randomUUID();
    const student = await prisma.student.create({
      data: {
        ra: studentRa,
        name: 'Aluno Idempotente',
        course: 'DSM',
        status: 'Ativo',
        admission: '20261',
        email: randomUUID() + '@example.test',
        password: 'unused',
        dueDate: new Date('2030-01-01'),
      },
    });
    const token = jwt.sign({
      sub: studentRa,
      accountId: student.accountId,
      role: 'student',
    });

    await checkpoint('check-in', 'open').expect(200);
    const qrResponse = await http()
      .get(`/events/${eventId}/checkpoints/check-in/qr`)
      .auth(secretaryToken, { type: 'bearer' })
      .expect(200);
    const reference = (qrResponse.body as { qrUrl: string }).qrUrl.split(
      '/p/',
    )[1];

    // Primeiro toque: sucesso
    await http()
      .post('/attendances/scan-reference')
      .auth(token, { type: 'bearer' })
      .send({ qrReference: reference })
      .expect(200);

    // Segundo toque imediato com a mesma referência: recusado sem criar registro duplicado
    const secondCall = await http()
      .post('/attendances/scan-reference')
      .auth(token, { type: 'bearer' })
      .send({ qrReference: reference });

    expect(secondCall.status).toBe(200);
    expect(secondCall.body).toMatchObject({
      success: false,
      code: 'ALREADY_CHECKED_IN',
    });
    expect(
      await prisma.attendance.count({
        where: { eventId, studentRa },
      }),
    ).toBe(1);
  });

  it('referenceGeneratedByConfiguredBackendResolvesThere: apenas referência gerada neste backend é resolvida', async () => {
    await checkpoint('check-in', 'open').expect(200);
    const qrResponse = await http()
      .get(`/events/${eventId}/checkpoints/check-in/qr`)
      .auth(secretaryToken, { type: 'bearer' })
      .expect(200);
    const reference = (qrResponse.body as { qrUrl: string }).qrUrl.split(
      '/p/',
    )[1];

    // Resolve com 200 no backend onde foi gerada
    const resolved = await http()
      .get(`/attendances/qr/${reference}`)
      .auth(studentToken, { type: 'bearer' })
      .expect(200);
    const resolvedBody = resolved.body as { event: { id: string } };
    expect(resolvedBody.event.id).toBe(eventId);

    // Referência de outro backend ou aleatória não resolve
    const foreignReference = 'foreignBackendRef12345';
    const foreignResult = await http()
      .get(`/attendances/qr/${foreignReference}`)
      .auth(studentToken, { type: 'bearer' })
      .expect(400);
    expect(foreignResult.body).toMatchObject({ code: 'EXPIRED_OR_INVALID_QR' });
  });
});
