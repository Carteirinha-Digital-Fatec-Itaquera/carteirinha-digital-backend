import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import { JwtModule, JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../database/prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { SecretaryActiveGuard } from '../project-credits/guards/secretary-active.guard';
import { CertificateService } from '../certificate/certificate.service';
import { PdfGeneratorService } from '../certificate/pdf-generator.service';
import { TechnologyPdfService } from '../certificate/technology-pdf.service';
import { EventManagementController } from './public-events.controller';
import { EventOperationsService } from './event-operations.service';
import { EventCatalogService } from './event-catalog.service';
import { EventStorageService } from './event-storage.service';
import { EventJobsService } from './event-jobs.service';
import { VisitorService, visitorIdentityHash } from './visitor.service';
import { StudentController } from '../student/student.controller';
import { StudentService } from '../student/student.service';
import { StudentMapper } from '../student/mapper/student.mapper';
import { UploadService } from '../upload/upload.service';
import { ActiveEventAccountGuard } from '../auth/active-event-account.guard';
import { EventController } from '../event/event.controller';
import { EventService } from '../event/event.service';
import { CheckpointService } from '../event/checkpoint.service';
import { QrTokenService } from '../event/qr-token.service';
import type { MailService } from '../mail/mail.service';

const url = process.env.MANUAL_CERTIFICATE_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
integration('Manual certificate issuance with real PostgreSQL and HTTP', () => {
  let db: PrismaClient;
  let app: INestApplication;
  let jwt: JwtService;
  let admin: string;
  let adminId: number;
  let operations: EventOperationsService;
  let worker: EventJobsService;
  let certificates: CertificateService;
  const storageFiles = new Map<string, Buffer>();
  const mail = {
    sendCertificateNotification: jest.fn().mockResolvedValue({}),
    sendVisitorCertificate: jest.fn(),
  };
  const storage = {
    put: jest.fn((buffer: Buffer, _pdf: boolean, key: string) => {
      storageFiles.set(key, buffer);
      return Promise.resolve({
        storageKey: key,
        sha256: createHash('sha256').update(buffer).digest('hex'),
      });
    }),
    get: jest.fn((key: string) => Promise.resolve(storageFiles.get(key)!)),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const body = () => ({
    identityType: 'EXTERNAL',
    name: 'Pessoa de teste',
    cpf: '52998224725',
    email: randomUUID() + '@example.test',
    reason: 'Participação conferida em lista presencial após falha de rede.',
    participationConfirmed: true,
  });
  const createEvent = (overrides: Partial<Prisma.EventCreateInput> = {}) =>
    db.event.create({
      data: {
        title: 'Atividade manual de teste',
        speaker: 'Docente teste',
        location: 'Auditório',
        startsAt: new Date(Date.now() - 7200000),
        endsAt: new Date(Date.now() - 3600000),
        workloadMinutes: 60,
        status: 'COMPLETED',
        checkpoints: { create: [{ type: 'CHECK_IN' }, { type: 'CHECK_OUT' }] },
        ...overrides,
      },
    });
  const post = (id: string, payload: unknown, token = admin) =>
    request(app.getHttpServer() as Server)
      .post(`/event-management/events/${id}/manual-certificates`)
      .auth(token, { type: 'bearer' })
      .send(payload as object);
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      target.hostname !== '127.0.0.1' ||
      !target.pathname.startsWith('/disposable_manual_certificates_')
    )
      throw new Error('Only dedicated local disposable database is allowed');
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const pdf = new PdfGeneratorService(
      new TechnologyPdfService(
        db as unknown as PrismaService,
        storage as unknown as EventStorageService,
      ),
    );
    certificates = new CertificateService(db as unknown as PrismaService, pdf);
    operations = new EventOperationsService(
      db as unknown as PrismaService,
      certificates,
      storage as unknown as EventStorageService,
    );
    worker = new EventJobsService(
      db as unknown as PrismaService,
      pdf,
      storage as unknown as EventStorageService,
      operations,
      mail as unknown as MailService,
    );
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: process.env.JWT_SECRET })],
      controllers: [
        EventManagementController,
        StudentController,
        EventController,
      ],
      providers: [
        AuthGuard,
        RolesGuard,
        SecretaryActiveGuard,
        ActiveEventAccountGuard,
        {
          provide: EventService,
          useValue: new EventService(db as unknown as PrismaService),
        },
        { provide: CheckpointService, useValue: {} },
        { provide: QrTokenService, useValue: {} },
        StudentMapper,
        { provide: UploadService, useValue: {} },
        {
          provide: StudentService,
          useValue: {
            getStudentByRa: (ra: string) =>
              db.student.findUniqueOrThrow({ where: { ra } }),
            updateStudents: (student: {
              ra: string;
              name: string;
              socialName?: string | null;
            }) =>
              db.student.update({
                where: { ra: student.ra },
                data: { name: student.name, socialName: student.socialName },
              }),
          },
        },
        { provide: PrismaService, useValue: db },
        { provide: EventOperationsService, useValue: operations },
        { provide: EventCatalogService, useValue: {} },
        { provide: TechnologyPdfService, useValue: {} },
        { provide: EventStorageService, useValue: storage },
        { provide: PdfGeneratorService, useValue: pdf },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    jwt = module.get(JwtService);
    const secretary = await db.secretary.create({
      data: {
        name: 'Secretaria teste',
        email: randomUUID() + '@example.test',
        password: randomUUID(),
        birthDate: new Date('1990-01-01'),
        dueDate: new Date(Date.now() + 86400000),
      },
    });
    adminId = secretary.id;
    admin = jwt.sign({ sub: adminId, role: 'secretary' });
  });
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  it('finds a system student without enrollment and issues once to the selected account', async () => {
    const event = await createEvent();
    const marker = randomUUID();
    const student = await db.student.create({
      data: {
        ra: randomUUID(),
        name: `Álvaro ${marker}`,
        course: 'DSM',
        email: randomUUID() + '@example.test',
        password: randomUUID(),
        status: 'Ativo',
        admission: '20261',
        dueDate: new Date(Date.now() + 86400000),
      },
    });
    const search = () =>
      request(app.getHttpServer() as Server)
        .get('/event-management/students/search')
        .query({ q: `alvaro ${marker}` });
    await search().expect(401);
    await search()
      .auth(
        jwt.sign({
          sub: student.ra,
          accountId: student.accountId,
          role: 'student',
        }),
        { type: 'bearer' },
      )
      .expect(403);
    const found = await search().auth(admin, { type: 'bearer' }).expect(200);
    expect((found.body as { items: { accountId: string }[] }).items).toEqual([
      expect.objectContaining({ accountId: student.accountId }),
    ]);
    expect(
      await db.eventParticipant.count({ where: { eventId: event.id } }),
    ).toBe(0);
    const input = {
      identityType: 'STUDENT',
      ra: student.ra,
      expectedAccountId: randomUUID(),
      reason: 'Participação conferida em lista pelo responsável.',
      participationConfirmed: true,
    };
    await post(event.id, input).expect(409);
    expect(await db.attendance.count({ where: { eventId: event.id } })).toBe(0);
    input.expectedAccountId = student.accountId;
    const response = await post(event.id, input).expect(201);
    const id = (response.body as { certificateId: string }).certificateId;
    const cert = await db.certificate.findUniqueOrThrow({
      where: { id },
      include: { attendance: true, artifact: true },
    });
    expect(cert.studentAccountId).toBe(student.accountId);
    expect(cert.studentRefRa).toBe(student.ra);
    expect(cert.attendance.status).toBe('CONFIRMED');
    expect(cert.attendance.checkInAt).not.toBeNull();
    expect(cert.attendance.checkOutAt).not.toBeNull();
    const mine = await certificates.getStudentCertificates({
      sub: student.ra,
      accountId: student.accountId,
      role: 'student',
    });
    expect(mine.some((item) => item.id === id)).toBe(true);
    await worker.process(cert.artifact!.id);
    expect(mail.sendCertificateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        email: student.email,
        profile: 'ALUNO',
        accessUrl: `${(process.env.STUDENT_APP_URL || 'https://carteirinha-digital-front-end-aluno.vercel.app').replace(/\/$/, '')}/certificados`,
      }),
    );
    const repeated = await post(event.id, input).expect(201);
    expect((repeated.body as { certificateId: string }).certificateId).toBe(id);
    expect(await db.certificate.count({ where: { eventId: event.id } })).toBe(
      1,
    );
    expect(
      (
        await db.certificateArtifact.findUniqueOrThrow({
          where: { certificateId: id },
        })
      ).deliveryState,
    ).toBe('SENT');
  });
  it('analyzes JSON and CSV without writes and scopes duplicate names to one eligible item', async () => {
    const event = await createEvent();
    const name = `Aluno Lote ${randomUUID()}`;
    await db.student.create({
      data: {
        ra: randomUUID(),
        name,
        course: 'DSM',
        status: 'Ativo',
        admission: '20261',
        email: randomUUID() + '@example.test',
        password: randomUUID(),
        dueDate: new Date(Date.now() + 86400000),
      },
    });
    const endpoint = `/event-management/events/${event.id}/participant-file`;
    await request(app.getHttpServer() as Server)
      .post(endpoint)
      .attach('file', Buffer.from(JSON.stringify([name])), 'test.json')
      .expect(401);
    const response = await request(app.getHttpServer() as Server)
      .post(endpoint)
      .auth(admin, { type: 'bearer' })
      .attach(
        'file',
        Buffer.from(
          JSON.stringify({
            participantes: [
              { nome: name },
              { nome: name },
              { nome: 'Pessoa inexistente no cadastro de teste' },
              { nome: name, status: 'professor' },
            ],
          }),
        ),
        'test.json',
      )
      .expect(201);
    const result = response.body as { items: { status: string }[] };
    expect(result.items.map((item) => item.status)).toEqual([
      'READY',
      'DUPLICATE',
      'NOT_FOUND',
      'REVIEW',
    ]);
    expect(await db.attendance.count({ where: { eventId: event.id } })).toBe(0);
    expect(await db.certificate.count({ where: { eventId: event.id } })).toBe(
      0,
    );
    const csv = await request(app.getHttpServer() as Server)
      .post(endpoint)
      .auth(admin, { type: 'bearer' })
      .attach('file', Buffer.from(`nome\n${name}`), 'test.csv')
      .expect(201);
    expect((csv.body as { items: { status: string }[] }).items[0].status).toBe(
      'READY',
    );
  });
  it('reissues a corrected version without exposing or restoring the previous document', async () => {
    const event = await createEvent();
    const student = await db.student.create({
      data: {
        ra: randomUUID(),
        name: 'Nome Fictício Inicial',
        course: 'DSM',
        status: 'Ativo',
        admission: '20261',
        email: randomUUID() + '@example.test',
        password: randomUUID(),
        dueDate: new Date(Date.now() + 86400000),
      },
    });
    const original = await post(event.id, {
      identityType: 'STUDENT',
      ra: student.ra,
      expectedAccountId: student.accountId,
      reason: 'Participação conferida presencialmente',
      participationConfirmed: true,
    }).expect(201);
    const originalId = (original.body as { certificateId: string })
      .certificateId;
    const previous = await db.certificate.findUniqueOrThrow({
      where: { id: originalId },
    });
    const payload = {
      requestId: randomUUID(),
      expectedVersion: 1,
      correctionType: 'SOCIAL_NAME',
      name: 'Nome Fictício Correto',
      reason: 'Correção solicitada e conferida pela Secretaria.',
      confirmed: true,
      saveSocialName: true,
    };
    const endpoint = `/event-management/certificates/${originalId}/reissue`;
    await request(app.getHttpServer() as Server)
      .post(endpoint)
      .send(payload)
      .expect(401);
    const preview = await request(app.getHttpServer() as Server)
      .post(endpoint + '-preview')
      .auth(admin, { type: 'bearer' })
      .send(payload)
      .expect(201);
    expect(preview.headers['content-type']).toContain('application/pdf');
    expect(
      await db.certificate.count({
        where: { attendanceId: previous.attendanceId },
      }),
    ).toBe(1);
    const result = await request(app.getHttpServer() as Server)
      .post(endpoint)
      .auth(admin, { type: 'bearer' })
      .send(payload)
      .expect(201);
    const nextId = (result.body as { certificateId: string }).certificateId;
    expect(nextId).not.toBe(originalId);
    const next = await db.certificate.findUniqueOrThrow({
      where: { id: nextId },
      include: { artifact: true },
    });
    expect(next.version).toBe(2);
    expect(next.replacesId).toBe(originalId);
    expect(next.verificationCode).not.toBe(previous.verificationCode);
    expect(next.payloadSnapshot).toMatchObject({ studentName: payload.name });
    expect(
      (await db.certificate.findUniqueOrThrow({ where: { id: originalId } }))
        .payloadSnapshot,
    ).toEqual(previous.payloadSnapshot);
    expect(
      await certificates.verifyCertificate(previous.verificationCode),
    ).toMatchObject({ valid: false, revoked: true });
    expect(
      JSON.stringify(
        await certificates.verifyCertificate(previous.verificationCode),
      ),
    ).not.toContain(student.name);
    const identity = {
      sub: student.ra,
      accountId: student.accountId,
      role: 'student' as const,
    };
    await expect(
      certificates.getStudentCertificate(originalId, identity),
    ).rejects.toThrow();
    expect(
      (await certificates.getStudentCertificates(identity)).map(
        (item) => item.id,
      ),
    ).toEqual([nextId]);
    const versionsPath = `/event-management/certificates/${nextId}/versions`;
    await request(app.getHttpServer() as Server)
      .get(versionsPath)
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get(versionsPath)
      .auth(jwt.sign(identity), { type: 'bearer' })
      .expect(403);
    const history = await request(app.getHttpServer() as Server)
      .get(versionsPath)
      .auth(admin, { type: 'bearer' })
      .expect(200);
    expect(
      (history.body as { version: number }[]).map((item) => item.version),
    ).toEqual([2, 1]);
    expect(JSON.stringify(history.body)).not.toContain(student.name);
    const repeated = await request(app.getHttpServer() as Server)
      .post(endpoint)
      .auth(admin, { type: 'bearer' })
      .send(payload)
      .expect(201);
    expect((repeated.body as { certificateId: string }).certificateId).toBe(
      nextId,
    );
    await request(app.getHttpServer() as Server)
      .post(endpoint)
      .auth(admin, { type: 'bearer' })
      .send({ ...payload, requestId: randomUUID() })
      .expect(409);
    await worker.process(next.artifact!.id);
    expect(mail.sendCertificateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ recipientName: payload.name }),
    );
    expect(
      (
        await db.attendance.findUniqueOrThrow({
          where: { id: next.attendanceId },
          include: { certificate: true },
        })
      ).certificate?.id,
    ).toBe(nextId);
    const after = await post(event.id, {
      identityType: 'STUDENT',
      ra: student.ra,
      reason: 'Repetição administrativa conferida',
      participationConfirmed: true,
    }).expect(201);
    expect((after.body as { certificateId: string }).certificateId).toBe(
      nextId,
    );
    expect(
      (await db.student.findUniqueOrThrow({ where: { ra: student.ra } }))
        .socialName,
    ).toBe(payload.name);
  });
  it('restricts social-name access and update to the authorized profile', async () => {
    const student = await db.student.create({
      data: {
        ra: randomUUID(),
        name: 'Cadastro Fictício',
        socialName: 'Nome Social Fictício',
        course: 'DSM',
        status: 'Ativo',
        admission: '20261',
        email: randomUUID() + '@example.test',
        password: randomUUID(),
        dueDate: new Date(Date.now() + 86400000),
      },
    });
    const endpoint = `/estudantes/encontrar-por-ra/${student.ra}`;
    const token = jwt.sign({
      sub: student.ra,
      accountId: student.accountId,
      role: 'student',
    });
    await request(app.getHttpServer() as Server)
      .get(endpoint)
      .expect(401);
    const own = await request(app.getHttpServer() as Server)
      .get(endpoint)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect((own.body as { name: string }).name).toBe(student.socialName);
    await request(app.getHttpServer() as Server)
      .get('/estudantes/encontrar-por-ra/outra-matricula')
      .auth(token, { type: 'bearer' })
      .expect(403);
    await request(app.getHttpServer() as Server)
      .put(`/estudantes/atualizar/${student.ra}`)
      .auth(token, { type: 'bearer' })
      .send({ socialName: 'Alteração proibida' })
      .expect(403);
    await request(app.getHttpServer() as Server)
      .put(`/estudantes/atualizar/${student.ra}`)
      .auth(admin, { type: 'bearer' })
      .send({ socialName: 'Nome Social Atualizado' })
      .expect(200);
    expect(
      (await db.student.findUniqueOrThrow({ where: { ra: student.ra } }))
        .socialName,
    ).toBe('Nome Social Atualizado');
  });
  it('restores cancelled events with audit, closed checkpoints and unchanged revoked certificates', async () => {
    const event = await createEvent();
    const student = await db.student.create({
      data: {
        ra: randomUUID(),
        name: 'Participante Fictício',
        course: 'DSM',
        status: 'Ativo',
        admission: '20261',
        email: randomUUID() + '@example.test',
        password: randomUUID(),
        dueDate: new Date(Date.now() + 86400000),
      },
    });
    const result = await post(event.id, {
      identityType: 'STUDENT',
      ra: student.ra,
      reason: 'Participação confirmada para teste',
      participationConfirmed: true,
    }).expect(201);
    const certificateId = (result.body as { certificateId: string })
      .certificateId;
    const service = new EventService(db as unknown as PrismaService);
    await service.cancel(
      event.id,
      'Cancelamento equivocado para teste',
      adminId,
    );
    const revoked = await db.certificate.findUniqueOrThrow({
      where: { id: certificateId },
    });
    const endpoint = `/events/${event.id}/restore`;
    await request(app.getHttpServer() as Server)
      .post(endpoint)
      .send({ reason: 'Correção administrativa' })
      .expect(401);
    await request(app.getHttpServer() as Server)
      .post(endpoint)
      .auth(
        jwt.sign({
          sub: student.ra,
          accountId: student.accountId,
          role: 'student',
        }),
        { type: 'bearer' },
      )
      .send({ reason: 'Correção administrativa' })
      .expect(403);
    await request(app.getHttpServer() as Server)
      .post(endpoint)
      .auth(admin, { type: 'bearer' })
      .send({ reason: ' ' })
      .expect(400);
    const response = await request(app.getHttpServer() as Server)
      .post(endpoint)
      .auth(admin, { type: 'bearer' })
      .send({ reason: 'Cancelamento foi realizado por engano' })
      .expect(200);
    expect(response.body).toMatchObject({
      status: 'COMPLETED',
      cancelledAt: null,
      cancelReason: null,
      cancelledById: null,
    });
    expect(
      await db.eventCheckpoint.count({
        where: { eventId: event.id, isOpen: true },
      }),
    ).toBe(0);
    expect(
      (await db.certificate.findUniqueOrThrow({ where: { id: certificateId } }))
        .revokedAt,
    ).toEqual(revoked.revokedAt);
    expect(
      await db.eventAudit.count({
        where: { eventId: event.id, action: 'EVENT_CANCELLATION_REVOKED' },
      }),
    ).toBe(1);
    await request(app.getHttpServer() as Server)
      .post(endpoint)
      .auth(admin, { type: 'bearer' })
      .send({ reason: 'Tentativa repetida de restauração' })
      .expect(409);
    const future = await createEvent({
      status: 'SCHEDULED',
      startsAt: new Date(Date.now() + 86400000),
      endsAt: new Date(Date.now() + 90000000),
    });
    await service.cancel(future.id, 'Erro operacional', adminId);
    expect(
      (await service.restore(future.id, 'Correção administrativa', adminId))
        .status,
    ).toBe('SCHEDULED');
    const ongoing = await createEvent({
      status: 'IN_PROGRESS',
      endsAt: new Date(Date.now() + 3600000),
    });
    await db.eventCheckpoint.updateMany({
      where: { eventId: ongoing.id, type: 'CHECK_OUT' },
      data: { isOpen: true, openedAt: new Date() },
    });
    await service.cancel(ongoing.id, 'Erro operacional durante saída', adminId);
    expect(
      (await service.restore(ongoing.id, 'Retomar operação conferida', adminId))
        .status,
    ).toBe('IN_PROGRESS');
    expect(
      await db.eventCheckpoint.count({
        where: { eventId: ongoing.id, isOpen: true },
      }),
    ).toBe(0);
    await service.cancel(
      future.id,
      'Novo cancelamento para teste concorrente',
      adminId,
    );
    const concurrent = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer() as Server)
          .post(`/events/${future.id}/restore`)
          .auth(admin, { type: 'bearer' })
          .send({ reason: 'Restauração concorrente conferida' }),
      ),
    );
    expect(concurrent.map((item) => item.status).sort()).toEqual([200, 409]);
    const legacy = await createEvent({
      status: 'CANCELLED',
      cancelReason: 'Histórico legado',
      cancelledAt: new Date(Date.now() - 10000),
    });
    expect(
      (
        await service.restore(
          legacy.id,
          'Restauração de registro legado',
          adminId,
        )
      ).status,
    ).toBe('COMPLETED');
    const series = await db.eventSeries.create({
      data: {
        title: 'Histórico expurgado fictício',
        slug: randomUUID(),
        startsAt: new Date(Date.now() - 7200000),
        endsAt: new Date(Date.now() - 3600000),
        retentionAt: new Date(Date.now() - 1000),
        purgedAt: new Date(),
        courses: [],
      },
    });
    const purged = await createEvent({
      status: 'CANCELLED',
      series: { connect: { id: series.id } },
    });
    await expect(
      service.restore(purged.id, 'Tentativa em histórico expurgado', adminId),
    ).rejects.toThrow('Histórico expurgado');
  });
  it('protects route, active secretary, DTO and confirmation', async () => {
    const event = await createEvent();
    await post(event.id, body(), '').expect(401);
    await post(
      event.id,
      body(),
      jwt.sign({ sub: 'student', accountId: 'account', role: 'student' }),
    ).expect(403);
    await post(
      event.id,
      body(),
      jwt.sign({ sub: 999999, role: 'secretary' }),
    ).expect(401);
    await post(event.id, { ...body(), participationConfirmed: false }).expect(
      400,
    );
    await post(event.id, { ...body(), reason: '   ' }).expect(400);
    await post(event.id, { ...body(), email: 'invalid' }).expect(400);
    await post('bad-id', body()).expect(400);
    expect(await db.certificate.count({ where: { eventId: event.id } })).toBe(
      0,
    );
  });
  it('emits for a person without account, creates real PDF and sends through the existing worker once', async () => {
    const event = await createEvent({ visitorsAllowed: false });
    const input = body();
    const response = await post(event.id, input).expect(201);
    const result = response.body as {
      certificateId: string;
      deliveryState: string;
      alreadyIssued: boolean;
    };
    expect(result.deliveryState).toBe('PENDING');
    expect(result.alreadyIssued).toBe(false);
    const record = await db.certificate.findUniqueOrThrow({
      where: { id: result.certificateId },
      include: {
        attendance: true,
        artifact: true,
        participant: { include: { visitor: true } },
      },
    });
    expect(record.attendance.status).toBe('CONFIRMED');
    expect(record.attendance.evidence).toMatchObject({
      manualCertificate: {
        decision: 'MANUAL',
        secretaryId: adminId,
        missingCheckIn: true,
        missingCheckOut: true,
      },
    });
    expect(record.payloadSnapshot).toMatchObject({
      studentName: input.name,
      eventTitle: event.title,
    });
    expect(record.participant?.visitor?.email).toBe(input.email);
    expect(await db.student.count({ where: { email: input.email } })).toBe(0);
    const persistedEvent = await db.event.findUniqueOrThrow({
      where: { id: event.id },
      include: { series: true },
    });
    expect(persistedEvent.visitorsAllowed).toBe(false);
    expect(persistedEvent.series?.published).toBe(false);
    const before = mail.sendCertificateNotification.mock.calls.length;
    await worker.process(record.artifact!.id);
    expect(mail.sendCertificateNotification.mock.calls.length).toBe(before + 1);
    const expectedAccessUrl: unknown = expect.stringContaining(
      '/visitantes/certificados',
    );
    expect(mail.sendCertificateNotification).toHaveBeenLastCalledWith(
      expect.objectContaining({
        email: input.email,
        profile: 'VISITANTE',
        accessUrl: expectedAccessUrl,
      }),
    );
    const ready = await db.certificateArtifact.findUniqueOrThrow({
      where: { certificateId: record.id },
    });
    expect(ready.deliveryState).toBe('SENT');
    expect(storageFiles.get(ready.storageKey!)?.subarray(0, 4).toString()).toBe(
      '%PDF',
    );
    await worker.process(record.artifact!.id);
    expect(mail.sendCertificateNotification.mock.calls.length).toBe(before + 1);
    const visitors = new VisitorService(
      db as unknown as PrismaService,
      mail as unknown as MailService,
    );
    const recovery = await visitors.recoverCertificates(input.cpf, '127.0.0.1');
    const ids = await visitors.certificateVisitorIds(undefined, recovery.token);
    expect(ids).toContain(record.participant?.visitorId);
    const audit = await db.eventAudit.findFirstOrThrow({
      where: { eventId: event.id, action: 'MANUAL_CERTIFICATE_ISSUED' },
    });
    expect(audit.secretaryId).toBe(adminId);
    expect(audit.reason).toBe(input.reason);
  });
  it('preserves recorded entry, links a legacy student attendance, and reuses certificate', async () => {
    const event = await createEvent();
    const ra = randomUUID();
    const student = await db.student.create({
      data: {
        ra,
        name: 'Aluno teste',
        course: 'DSM',
        email: randomUUID() + '@example.test',
        password: randomUUID(),
        status: 'Ativo',
        admission: '20261',
        dueDate: new Date(Date.now() + 86400000),
      },
    });
    const entry = new Date(Date.now() - 7200000);
    await db.attendance.create({
      data: {
        eventId: event.id,
        studentRa: ra,
        studentRefRa: ra,
        studentAccountId: student.accountId,
        studentName: student.name,
        studentCourse: student.course,
        checkInAt: entry,
        evidence: { original: 'QR' },
      },
    });
    const input = {
      identityType: 'STUDENT',
      ra,
      reason: 'Saída conferida após problema no aplicativo.',
      participationConfirmed: true,
    };
    const first = await post(event.id, input).expect(201);
    const second = await post(event.id, input).expect(201);
    expect((first.body as { certificateId: string }).certificateId).toBe(
      (second.body as { certificateId: string }).certificateId,
    );
    expect((second.body as { alreadyIssued: boolean }).alreadyIssued).toBe(
      true,
    );
    const row = await db.attendance.findUniqueOrThrow({
      where: { eventId_studentRa: { eventId: event.id, studentRa: ra } },
    });
    expect(row.checkInAt).toEqual(entry);
    expect(row.evidence).toMatchObject({
      original: 'QR',
      manualCertificate: { missingCheckIn: false },
    });
    expect(await db.certificate.count({ where: { eventId: event.id } })).toBe(
      1,
    );
  });
  it('serializes concurrent submissions and rejects conflicting identity', async () => {
    const event = await createEvent();
    const input = body();
    const responses = await Promise.all([
      post(event.id, input),
      post(event.id, input),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect((responses[0].body as { certificateId: string }).certificateId).toBe(
      (responses[1].body as { certificateId: string }).certificateId,
    );
    expect(await db.certificate.count({ where: { eventId: event.id } })).toBe(
      1,
    );
    expect(
      await db.eventParticipant.count({ where: { eventId: event.id } }),
    ).toBe(1);
    await post(event.id, { ...input, email: 'other@example.test' }).expect(409);
    await post(event.id, { ...input, cpf: '11111111111' }).expect(400);
  });
  it('rejects cancelled, scheduled, disabled, expired events and unknown students', async () => {
    for (const overrides of [
      { status: 'CANCELLED' as const },
      { status: 'SCHEDULED' as const },
      { certificateEnabled: false },
      { endsAt: new Date(Date.now() - 31 * 86400000) },
    ]) {
      const event = await createEvent(overrides);
      await post(event.id, body()).expect(409);
      expect(await db.certificate.count({ where: { eventId: event.id } })).toBe(
        0,
      );
    }
    const event = await createEvent();
    await post(event.id, {
      identityType: 'STUDENT',
      ra: 'missing',
      reason: 'Participação conferida manualmente.',
      participationConfirmed: true,
    }).expect(400);
  });
  it('rolls back identity, attendance and internal context if template cannot be issued', async () => {
    const event = await createEvent({
      certificatePolicies: {
        ATTENDEE: { templateId: randomUUID(), signerIds: [] },
      },
    });
    await post(event.id, body()).expect(409);
    expect(
      await db.eventParticipant.count({ where: { eventId: event.id } }),
    ).toBe(0);
    expect(await db.attendance.count({ where: { eventId: event.id } })).toBe(0);
    expect(
      (await db.event.findUniqueOrThrow({ where: { id: event.id } })).seriesId,
    ).toBeNull();
  });
  it('never restores or requeues revoked certificates', async () => {
    const event = await createEvent();
    const input = body();
    const response = await post(event.id, input).expect(201);
    const id = (response.body as { certificateId: string }).certificateId;
    await db.certificate.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await post(event.id, input).expect(409);
    expect(await db.certificate.count({ where: { eventId: event.id } })).toBe(
      1,
    );
  });
  it('uses the configured event template and signers for the issued PDF', async () => {
    const pixel = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const key = 'synthetic-signature-' + randomUUID();
    storageFiles.set(key, pixel);
    const asset = await db.eventAsset.create({
      data: {
        kind: 'SIGNATURE',
        storageKey: key,
        sha256: createHash('sha256').update(pixel).digest('hex'),
      },
    });
    const signer = await db.certificateSigner.create({
      data: {
        name: 'Assinante fictício',
        title: 'Responsável teste',
        assetId: asset.id,
        authorizedAt: new Date(),
      },
    });
    const template = await db.certificateTemplate.create({
      data: {
        name: 'Modelo teste ' + randomUUID(),
        role: 'ATTENDEE',
        version: 1,
        status: 'PUBLISHED',
        config: {
          design: 'TECHNOLOGY_BLUE_2026_DARK',
          heading: 'CERTIFICADO',
          edition: 'Evento teste',
          wordingVersion: 'LECTURE_LISTENER_2026',
        },
      },
    });
    const event = await createEvent({
      certificatePolicies: {
        ATTENDEE: { templateId: template.id, signerIds: [signer.id] },
      },
    });
    const response = await post(event.id, body()).expect(201);
    const id = (response.body as { certificateId: string }).certificateId;
    const cert = await db.certificate.findUniqueOrThrow({
      where: { id },
      include: { artifact: true },
    });
    expect(cert.payloadSnapshot).toMatchObject({
      version: 2,
      template: { id: template.id },
      signers: [{ name: signer.name }],
    });
    await worker.process(cert.artifact!.id);
    expect(
      (
        await db.certificateArtifact.findUniqueOrThrow({
          where: { certificateId: id },
        })
      ).state,
    ).toBe('READY');
  });
  it('reissues V2 with historical template and signers after the event configuration changes', async () => {
    const template = await db.certificateTemplate.findFirstOrThrow({
      where: { status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' },
    });
    const signer = await db.certificateSigner.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });
    // Use assets created during this test run, without any personal signature.
    if (
      !storageFiles.has(
        (
          await db.eventAsset.findUniqueOrThrow({
            where: { id: signer.assetId },
          })
        ).storageKey,
      )
    )
      throw new Error('Synthetic test asset missing');
    const event = await createEvent({
      certificatePolicies: {
        ATTENDEE: { templateId: template.id, signerIds: [signer.id] },
      },
    });
    const student = await db.student.create({
      data: {
        ra: randomUUID(),
        name: 'Pessoa Modelo Teste',
        course: 'DSM',
        status: 'Ativo',
        admission: '20261',
        socialName: 'Pessoa Social Teste',
        email: randomUUID() + '@example.test',
        password: randomUUID(),
        dueDate: new Date(Date.now() + 86400000),
      },
    });
    const result = await post(event.id, {
      identityType: 'STUDENT',
      ra: student.ra,
      reason: 'Presença conferida para teste local',
      participationConfirmed: true,
    }).expect(201);
    const id = (result.body as { certificateId: string }).certificateId;
    const original = await db.certificate.findUniqueOrThrow({ where: { id } });
    expect(original.payloadSnapshot).toMatchObject({
      version: 2,
      studentName: student.socialName,
    });
    await db.event.update({
      where: { id: event.id },
      data: {
        title: 'Título posterior que não deve alterar o documento',
        workloadMinutes: 300,
      },
    });
    const dto = {
      requestId: randomUUID(),
      expectedVersion: 1,
      correctionType: 'SPELLING',
      name: 'Pessoa Corrigida Teste',
      reason: 'Correção individual conferida presencialmente.',
      confirmed: true,
    };
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer() as Server)
          .post(`/event-management/certificates/${id}/reissue`)
          .auth(admin, { type: 'bearer' })
          .send(dto),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const nextId = (responses[0].body as { certificateId: string })
      .certificateId;
    expect((responses[1].body as { certificateId: string }).certificateId).toBe(
      nextId,
    );
    const next = await db.certificate.findUniqueOrThrow({
      where: { id: nextId },
      include: { artifact: true },
    });
    expect(next.payloadSnapshot).toEqual({
      ...(original.payloadSnapshot as object),
      studentName: dto.name,
    });
    await worker.process(next.artifact!.id);
    expect(
      (
        await db.certificateArtifact.findUniqueOrThrow({
          where: { certificateId: nextId },
        })
      ).state,
    ).toBe('READY');
    await expect(operations.download(id)).rejects.toThrow();
    expect(
      (await operations.download(nextId)).buffer.subarray(0, 4).toString(),
    ).toBe('%PDF');
  });
  it('links CPF to an existing legacy visitor without creating another identity', async () => {
    const input = body();
    const series = await db.eventSeries.create({
      data: {
        title: 'Edição teste',
        slug: randomUUID(),
        startsAt: new Date(Date.now() - 7200000),
        endsAt: new Date(Date.now() - 3600000),
        retentionAt: new Date(Date.now() + 86400000),
        courses: [],
        published: true,
      },
    });
    const event = await createEvent({ series: { connect: { id: series.id } } });
    const visitor = await db.visitorRegistration.create({
      data: {
        seriesId: series.id,
        name: input.name,
        email: input.email,
        emailHash: visitorIdentityHash(input.email),
      },
    });
    await post(event.id, input).expect(201);
    expect(
      (
        await db.visitorRegistration.findUniqueOrThrow({
          where: { id: visitor.id },
        })
      ).cpfHash,
    ).toBe(visitorIdentityHash(`cpf:${input.cpf}`));
    expect(
      await db.visitorRegistration.count({ where: { seriesId: series.id } }),
    ).toBe(1);
  });
  it('recovers an existing certificate without artifact without issuing a second certificate', async () => {
    const event = await createEvent();
    const input = body();
    const first = await post(event.id, input).expect(201);
    const id = (first.body as { certificateId: string }).certificateId;
    await db.certificateArtifact.delete({ where: { certificateId: id } });
    const recovered = await post(event.id, input).expect(201);
    expect((recovered.body as { alreadyIssued: boolean }).alreadyIssued).toBe(
      true,
    );
    expect((recovered.body as { message: string }).message).toContain(
      'enfileirados',
    );
    expect(await db.certificate.count({ where: { eventId: event.id } })).toBe(
      1,
    );
    expect(
      (
        await db.certificateArtifact.findUniqueOrThrow({
          where: { certificateId: id },
        })
      ).deliveryState,
    ).toBe('PENDING');
  });
  it('confirms missing checkout by attendance row with closed QR and preserves entry/evidence', async () => {
    const event = await createEvent();
    const ra = randomUUID();
    const student = await db.student.create({
      data: {
        ra,
        name: 'Aluno sem saída',
        course: 'DSM',
        email: randomUUID() + '@example.test',
        password: randomUUID(),
        status: 'Ativo',
        admission: '20261',
        dueDate: new Date(Date.now() + 86400000),
      },
    });
    const entry = new Date(Date.now() - 7200000);
    const attendance = await db.attendance.create({
      data: {
        eventId: event.id,
        studentRa: ra,
        studentRefRa: ra,
        studentAccountId: student.accountId,
        studentName: student.name,
        studentCourse: student.course,
        checkInAt: entry,
        evidence: { original: 'QR' },
      },
    });
    const payload = {
      attendanceId: attendance.id,
      checkpoint: 'CHECK_OUT',
      reason: 'Saída conferida presencialmente pela Secretaria.',
    };
    const requestCheckout = () =>
      request(app.getHttpServer() as Server)
        .post(`/event-management/events/${event.id}/manual-presence`)
        .auth(admin, { type: 'bearer' })
        .send(payload);
    await Promise.all([
      requestCheckout().expect(201),
      requestCheckout().expect(201),
    ]);
    const updated = await db.attendance.findUniqueOrThrow({
      where: { id: attendance.id },
    });
    expect(updated.checkInAt).toEqual(entry);
    expect(updated.status).toBe('CONFIRMED');
    expect(updated.checkOutAt).not.toBeNull();
    expect(updated.evidence).toMatchObject({
      original: 'QR',
      manualPresence: { checkpoint: 'CHECK_OUT', secretaryId: adminId },
    });
    expect(await db.certificate.count({ where: { eventId: event.id } })).toBe(
      1,
    );
    expect(
      await db.eventAudit.count({
        where: { eventId: event.id, action: 'MANUAL_CHECK_OUT' },
      }),
    ).toBe(2);
    const linked = await operations.participants(event.id);
    expect(
      linked.some((person) => person.attendance?.id === attendance.id),
    ).toBe(true);
    const otherEvent = await createEvent();
    await request(app.getHttpServer() as Server)
      .post(`/event-management/events/${otherEvent.id}/manual-presence`)
      .auth(admin, { type: 'bearer' })
      .send(payload)
      .expect(404);
    await request(app.getHttpServer() as Server)
      .post(`/event-management/events/${event.id}/manual-presence`)
      .auth(admin, { type: 'bearer' })
      .send({ ...payload, participantId: randomUUID() })
      .expect(400);
    const missingEntry = await db.attendance.create({
      data: {
        eventId: otherEvent.id,
        studentRa: ra,
        studentRefRa: ra,
        studentAccountId: student.accountId,
        studentName: student.name,
        studentCourse: student.course,
      },
    });
    await request(app.getHttpServer() as Server)
      .post(`/event-management/events/${otherEvent.id}/manual-presence`)
      .auth(admin, { type: 'bearer' })
      .send({ ...payload, attendanceId: missingEntry.id })
      .expect(400);
    expect(
      await db.eventParticipant.count({ where: { eventId: otherEvent.id } }),
    ).toBe(0);
  });
  it('bulk checkout is atomic, auditable, scoped to event and safe to repeat', async () => {
    const event = await createEvent();
    const add = async (eventId: string) => {
      const ra = randomUUID();
      const student = await db.student.create({
        data: {
          ra,
          name: 'Aluno lote',
          course: 'DSM',
          email: randomUUID() + '@example.test',
          password: randomUUID(),
          status: 'Ativo',
          admission: '20261',
          dueDate: new Date(Date.now() + 86400000),
        },
      });
      return db.attendance.create({
        data: {
          eventId,
          studentRa: ra,
          studentRefRa: ra,
          studentAccountId: student.accountId,
          studentName: student.name,
          studentCourse: student.course,
          checkInAt: new Date(Date.now() - 7200000),
          evidence: { original: 'QR' },
        },
      });
    };
    const rows = await Promise.all([add(event.id), add(event.id)]);
    const payload = {
      attendanceIds: rows.map((row) => row.id),
      reason: 'Saídas conferidas em lista presencial pela Secretaria.',
      confirmed: true,
    };
    const send = (id: string, body: object, token = admin) =>
      request(app.getHttpServer() as Server)
        .post(`/event-management/events/${id}/manual-checkouts`)
        .auth(token, { type: 'bearer' })
        .send(body);
    await send(event.id, payload, '').expect(401);
    await send(event.id, { ...payload, confirmed: false }).expect(400);
    await send(event.id, { ...payload, attendanceIds: [] }).expect(400);
    await send(event.id, {
      ...payload,
      attendanceIds: [rows[0].id, rows[0].id],
    }).expect(400);
    await send(event.id, {
      ...payload,
      attendanceIds: Array.from({ length: 51 }, () => randomUUID()),
    }).expect(400);
    const first = await send(event.id, payload).expect(201);
    expect(first.body as object).toMatchObject({
      confirmedCount: 2,
      alreadyConfirmedCount: 0,
      processedIds: payload.attendanceIds,
    });
    const second = await send(event.id, payload).expect(201);
    expect(second.body as object).toMatchObject({
      confirmedCount: 0,
      alreadyConfirmedCount: 2,
    });
    for (const row of rows) {
      const saved = await db.attendance.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(saved.checkInAt).toEqual(row.checkInAt);
      expect(saved.checkOutAt).not.toBeNull();
      expect(saved.evidence).toMatchObject({ original: 'QR' });
    }
    expect(await db.certificate.count({ where: { eventId: event.id } })).toBe(
      2,
    );
    expect(
      await db.eventAudit.count({
        where: { eventId: event.id, action: 'MANUAL_CHECK_OUT' },
      }),
    ).toBe(2);
    expect(
      await db.eventAudit.count({
        where: { eventId: event.id, action: 'BULK_MANUAL_CHECK_OUT' },
      }),
    ).toBe(2);
    const other = await createEvent();
    await send(other.id, payload).expect(400);
    const cancelled = await createEvent({ status: 'CANCELLED' });
    await send(cancelled.id, payload).expect(409);
    const rollbackEvent = await createEvent();
    const valid = await add(rollbackEvent.id);
    const invalid = await db.attendance.create({
      data: {
        eventId: rollbackEvent.id,
        studentRa: 'missing-' + randomUUID(),
        studentAccountId: randomUUID(),
        studentName: 'Identidade indisponível',
        studentCourse: 'DSM',
        checkInAt: new Date(),
      },
    });
    await send(rollbackEvent.id, {
      ...payload,
      attendanceIds: [valid.id, invalid.id],
    }).expect(409);
    expect(
      (await db.attendance.findUniqueOrThrow({ where: { id: valid.id } }))
        .checkOutAt,
    ).toBeNull();
    expect(
      await db.certificate.count({ where: { eventId: rollbackEvent.id } }),
    ).toBe(0);
    expect(
      await db.eventAudit.count({ where: { eventId: rollbackEvent.id } }),
    ).toBe(0);
  });
});
