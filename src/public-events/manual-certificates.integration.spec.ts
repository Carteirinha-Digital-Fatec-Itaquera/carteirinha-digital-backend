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
      controllers: [EventManagementController],
      providers: [
        AuthGuard,
        RolesGuard,
        SecretaryActiveGuard,
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
});
