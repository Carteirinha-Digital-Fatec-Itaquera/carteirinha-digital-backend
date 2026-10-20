import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { JwtService } from '@nestjs/jwt';
import sharp from 'sharp';
import { PrismaService } from '../src/database/prisma.service';
import { MailService } from '../src/mail/mail.service';
import { EventStorageService } from '../src/public-events/event-storage.service';
import { VisitorService } from '../src/public-events/visitor.service';
import { EventCatalogService } from '../src/public-events/event-catalog.service';
import { EventOperationsService } from '../src/public-events/event-operations.service';
import { EventJobsService } from '../src/public-events/event-jobs.service';
import { TechnologyPdfService } from '../src/certificate/technology-pdf.service';
import { PdfGeneratorService } from '../src/certificate/pdf-generator.service';
import { CertificateService } from '../src/certificate/certificate.service';
import { AttendanceService } from '../src/attendance/attendance.service';
import { CheckpointService } from '../src/event/checkpoint.service';
import { EventService } from '../src/event/event.service';
import { QrTokenService } from '../src/event/qr-token.service';
import { AttendanceQrReferenceService } from '../src/attendance/attendance-qr-reference.service';
import type { CertificateSnapshot } from '../src/certificate/certificate.snapshot';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PublicEventsModule } from '../src/public-events/public-events.module';

const url = new URL(process.env.DIRECT_URL || '');
if (
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  !url.pathname.startsWith('/public_events_validation_')
)
  throw new Error(
    'Este teste exige banco local exclusivo public_events_validation_*.',
  );
process.env.JWT_SECRET = 'local-only-test-auth-secret-32-characters-2026';
process.env.ATTENDANCE_QR_SECRET =
  'local-only-test-qr-secret-different-32-characters-2026';
const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.toString() }),
});
const prisma = client as unknown as PrismaService;
const files = new Map<string, Buffer>();
let otp = '',
  sent = 0;
const mail = {
  sendVisitorCode: async (_email: string, code: string) => {
    otp = code;
  },
  sendVisitorCertificate: async () => {
    sent++;
  },
} as unknown as MailService;
const storage = {
  put: async (buffer: Buffer, _pdf = false, requestedKey?: string) => {
    const key = requestedKey || randomUUID();
    files.set(key, buffer);
    return {
      storageKey: key,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  },
  get: async (key: string) => {
    const file = files.get(key);
    if (!file) throw new Error('Asset ausente');
    return file;
  },
  remove: async (key: string) => {
    files.delete(key);
  },
} as unknown as EventStorageService;
const catalog = new EventCatalogService(prisma, storage),
  visitors = new VisitorService(prisma, mail);
const technology = new TechnologyPdfService(prisma, storage),
  pdf = new PdfGeneratorService(technology);
const certificates = new CertificateService(prisma, pdf, storage),
  operations = new EventOperationsService(prisma, certificates, storage);
const jobs = new EventJobsService(prisma, pdf, storage, operations, mail),
  jwt = new JwtService();
const attendance = new AttendanceService(prisma, jwt, certificates),
  checkpoints = new CheckpointService(prisma),
  events = new EventService(prisma);
const refs = new AttendanceQrReferenceService(prisma),
  qr = new QrTokenService(jwt, refs);
const run = randomUUID();
async function main() {
  const edition = await catalog.series(
    {
      title: `Edição de teste ${run}`,
      slug: `test-${run}`,
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 86400000).toISOString(),
      published: true,
      courses: ['DSM'],
    },
    1,
  );
  const signature = await sharp({
    create: {
      width: 240,
      height: 80,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0.05 },
    },
  })
    .png()
    .toBuffer();
  const stored = await storage.put(signature);
  const asset = await client.eventAsset.create({
    data: { kind: 'SIGNATURE', ...stored },
  });
  const signer = await catalog.signer(
    {
      name: 'Responsável de teste',
      title: 'Coordenador de teste — assinatura fictícia',
      assetId: asset.id,
      authorized: true,
    },
    1,
  );
  const attendee = await catalog.template(
    {
      name: `Modelo ${run}`,
      role: 'ATTENDEE',
      heading: 'CERTIFICADO',
      edition: 'XIII Semana de Tecnologia da Fatec Itaquera',
    },
    1,
  );
  const speaker = await catalog.template(
    {
      name: `Modelo ${run}`,
      role: 'SPEAKER',
      heading: 'CERTIFICADO',
      edition: 'XIII Semana de Tecnologia da Fatec Itaquera',
    },
    1,
  );
  await catalog.templateStatus(attendee.id, 'PUBLISHED', 1);
  await catalog.templateStatus(speaker.id, 'PUBLISHED', 1);
  const event = await events
    .create(
      {
        title: `Palestra ${run}`,
        speaker: 'Palestrante fictício',
        location: 'Local de teste',
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 7200000).toISOString(),
        workloadMinutes: 120,
      },
      1,
    )
    .catch(async () => {
      // FK do autor usa a conta fictícia criada exclusivamente neste banco de teste.
      const secretary = await client.secretary.create({
        data: {
          name: 'Operador teste',
          email: `${run}@example.invalid`,
          password: 'not-a-real-password',
          birthDate: new Date('1990-01-01'),
          dueDate: new Date('2030-01-01'),
        },
      });
      return events.create(
        {
          title: `Palestra ${run}`,
          speaker: 'Palestrante fictício',
          location: 'Local de teste',
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 7200000).toISOString(),
          workloadMinutes: 120,
        },
        secretary.id,
      );
    });
  const config = {
    seriesId: edition.id,
    visitorsAllowed: true,
    organizerCourse: 'DSM',
    windowMinutes: 15,
    attendeeTemplateId: attendee.id,
    speakerTemplateId: speaker.id,
    signerIds: [signer.id],
    geoPolicy: { latitude: 0, longitude: 0, radius: 150, maxAccuracy: 50 },
  };
  await assert.rejects(
    catalog.configure(event.id, { ...config, geoPolicy: null }, 1),
  );
  await catalog.configure(event.id, config, 1);
  await assert.rejects(catalog.series({ title: edition.title, slug: edition.slug, startsAt: new Date(Date.now() + 3 * 86400000).toISOString(), endsAt: new Date(Date.now() + 4 * 86400000).toISOString(), published: true, courses: ['DSM'] }, 1, edition.id));
  const module = await Test.createTestingModule({
    imports: [PublicEventsModule],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(MailService)
    .useValue(mail)
    .overrideProvider(EventStorageService)
    .useValue(storage)
    .compile();
  const app = module.createNestApplication();
  app.enableCors({ origin: true }); // Exclusivo do servidor de teste local.
  app.useGlobalPipes(new ValidationPipe());
  await app.init();
  try {
    await request(app.getHttpServer())
      .get('/event-management/catalog')
      .expect(401);
    const studentToken = await jwt.signAsync(
      { sub: 'not-a-real-student', role: 'student', accountId: 'test' },
      { secret: process.env.JWT_SECRET },
    );
    await request(app.getHttpServer())
      .get('/event-management/catalog')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(403);
    const secretaryToken = await jwt.signAsync(
      { sub: event.createdById, role: 'secretary' },
      { secret: process.env.JWT_SECRET },
    );
    const removedSecretary = await jwt.signAsync(
      { sub: 2147483647, role: 'secretary' },
      { secret: process.env.JWT_SECRET },
    );
    await request(app.getHttpServer())
      .get(`/events/${event.id}/attendances`)
      .set('Authorization', `Bearer ${removedSecretary}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/event-management/catalog')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    const origin = 'http://localhost:5173';
    const payload = {
      seriesId: edition.id,
      name: 'Visitante HTTP',
      email: `http-${run}@example.invalid`,
    };
    await request(app.getHttpServer())
      .post('/visitor/registration')
      .send(payload)
      .expect(400);
    await request(app.getHttpServer())
      .post('/visitor/registration')
      .set('Origin', origin)
      .send({ ...payload, role: 'secretary' })
      .expect(400);
    const registrationHttp = await request(app.getHttpServer())
      .post('/visitor/registration')
      .set('Origin', origin)
      .send(payload)
      .expect(200);
    const cookies = registrationHttp.headers['set-cookie'] as unknown as string[];
    assert.match(cookies[0], /HttpOnly/);
    assert.match(cookies[0], /SameSite=Lax/);
    assert.equal(JSON.stringify(registrationHttp.body).includes('token'), false);
    const sessionCookie = cookies[0].split(';')[0];
    await request(app.getHttpServer())
      .get('/visitor/session')
      .set('Cookie', sessionCookie)
      .expect(200);
    await request(app.getHttpServer())
      .get('/event-management/catalog')
      .set('Cookie', sessionCookie)
      .expect(401);
    await request(app.getHttpServer())
      .post('/visitor/logout')
      .set('Origin', 'https://untrusted.invalid')
      .set('Cookie', sessionCookie)
      .expect(400);
    await request(app.getHttpServer())
      .post('/visitor/logout')
      .set('Origin', origin)
      .set('Cookie', sessionCookie)
      .expect(200);
    await request(app.getHttpServer())
      .get('/visitor/session')
      .set('Cookie', sessionCookie)
      .expect(401);
    if (process.env.PUBLIC_EVENTS_BROWSER === '1') {
      await app.listen(5309, '127.0.0.1');
      let playwrightPkg: any;
      try {
        playwrightPkg = require('playwright');
      } catch {
        try {
          playwrightPkg = require('../../carteirinha-digital-front-end-aluno/node_modules/playwright');
        } catch {
          playwrightPkg = null;
        }
      }
      if (!playwrightPkg) return;
      const { chromium } = playwrightPkg;
      const browser = await chromium.launch({
        headless: true,
        ...(process.env.PUBLIC_EVENTS_BROWSER_EXECUTABLE
          ? { executablePath: process.env.PUBLIC_EVENTS_BROWSER_EXECUTABLE }
          : {}),
      });
      try {
        const context = await browser.newContext({
          viewport: { width: 390, height: 844 },
          permissions: ['geolocation'],
          geolocation: { latitude: 0, longitude: 0, accuracy: 5 },
        });
        const page = await context.newPage();
        await page.goto('http://localhost:5187/visitantes');
        await page.getByRole('combobox').first().selectOption(edition.id);
        await page
          .getByLabel('Nome completo', { exact: true })
          .fill('Visitante navegador');
        await page
          .getByLabel('E-mail', { exact: true })
          .fill(`browser-${run}@example.invalid`);
        await page
          .getByRole('button', {
            name: 'Receber código de acesso',
            exact: true,
          })
          .click();
        await page.getByLabel('Código recebido por e-mail').waitFor();
        await page.getByLabel('Código recebido por e-mail').fill(otp);
        await page
          .getByRole('button', { name: 'Confirmar e-mail', exact: true })
          .click();
        await page
          .getByRole('heading', { name: 'Olá, Visitante navegador' })
          .waitFor();
        const browserEvent = await events.create(
          {
            title: 'Palestra do navegador',
            speaker: 'Palestrante fictício',
            location: 'Local simulado do teste',
            startsAt: new Date().toISOString(),
            endsAt: new Date(Date.now() + 3600000).toISOString(),
            workloadMinutes: 60,
          },
          event.createdById!,
        );
        await catalog.configure(browserEvent.id, config, 1);
        for (const type of ['CHECK_IN', 'CHECK_OUT'] as const) {
          if (type === 'CHECK_OUT')
            await checkpoints.close(browserEvent.id, 'CHECK_IN');
          await checkpoints.open(browserEvent.id, type);
          const checkpoint = await checkpoints.getOpen(browserEvent.id, type);
          const result = await qr.generate({
            eventId: browserEvent.id,
            checkpoint: type,
            checkpointVersion: checkpoint.version,
            checkpointId: checkpoint.id,
          });
          const reference = new URL(result.qrUrl!).pathname;
          await page.goto(`http://localhost:5187${reference}`);
          await page
            .getByRole('button', { name: 'Confirmar presença', exact: true })
            .click();
          await page
            .getByRole('status')
            .filter({
              hasText:
                type === 'CHECK_IN'
                  ? 'Entrada registrada'
                  : 'Presença confirmada',
            })
            .waitFor();
        }
        const browserCert = await client.certificate.findFirstOrThrow({
          where: { eventId: browserEvent.id },
          include: { artifact: true },
        });
        await jobs.process(browserCert.artifact!.id);
        await page
          .getByRole('button', { name: 'Atualizar certificados', exact: true })
          .click();
        const fileDownload = page.waitForEvent('download');
        await page
          .getByRole('button', { name: 'Baixar PDF', exact: true })
          .click();
        assert.equal(
          (await fileDownload).suggestedFilename(),
          'certificado.pdf',
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        const evidence = process.env.PUBLIC_EVENTS_BROWSER_EVIDENCE;
        if (evidence)
          await page.screenshot({
            path: `${evidence}/visitor-mobile.png`,
            fullPage: true,
          });
        const adminContext = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
        });
        const adminToken = await jwt.signAsync(
          { sub: event.createdById, role: 'secretary' },
          { secret: process.env.JWT_SECRET, expiresIn: '1h' },
        );
        await adminContext.addInitScript(
          (token) => sessionStorage.setItem('token', token),
          adminToken,
        );
        const admin = await adminContext.newPage();
        await admin.goto('http://localhost:5188/eventos/publicos');
        await admin
          .getByRole('heading', {
            name: 'Eventos públicos e certificados',
            exact: true,
          })
          .waitFor();
        await admin
          .getByRole('button', { name: 'Assinaturas', exact: true })
          .click();
        await admin
          .getByRole('heading', {
            name: 'Cadastrar responsável e assinatura',
            exact: true,
          })
          .waitFor();
        assert.equal(
          await admin.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        if (evidence)
          await admin.screenshot({
            path: `${evidence}/secretary-desktop.png`,
            fullPage: true,
          });
        await admin.setViewportSize({ width: 390, height: 844 });
        assert.equal(
          await admin.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        if (evidence)
          await admin.screenshot({
            path: `${evidence}/secretary-mobile.png`,
            fullPage: true,
          });
        await adminContext.close();
        await context.close();
        console.log(
          'PASS navegador: OTP, cookie via proxy, QR entrada/saída, localização simulada, PDF e telas sem overflow em desktop/mobile.',
        );
      } finally {
        await browser.close();
      }
    }
  } finally {
    await app.close();
  }
  const registration = await visitors.register(
    {
      seriesId: edition.id,
      name: 'Visitante de teste',
      email: `${run}@example.invalid`,
      course: 'DSM',
    },
    run,
  );
  const session = registration;
  assert.equal(
    (await visitors.session(session.token)).name,
    'Visitante de teste',
  );
  const participant = await visitors.participant(
    registration.visitorId,
    event.id,
  );
  assert.equal(
    await client.student.count({ where: { email: `${run}@example.invalid` } }),
    0,
  );
  await checkpoints.open(event.id, 'CHECK_IN');
  let cp = await checkpoints.getOpen(event.id, 'CHECK_IN');
  assert.equal(cp.closesAt!.getTime() - cp.openedAt!.getTime(), 900000);
  let token = (
    await qr.generate({
      eventId: event.id,
      checkpoint: 'CHECK_IN',
      checkpointVersion: cp.version,
      checkpointId: cp.id,
    })
  ).qrToken;
  const user = { role: 'student' as const, sub: '' };
  await assert.rejects(attendance.scan(token, user, undefined, participant.id));
  const challenge = async (checkpoint: string, version: number) =>
    client.presenceChallenge.create({
      data: {
        identity: participant.id,
        eventId: event.id,
        checkpoint,
        checkpointVersion: version,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
  let nonce = await challenge('CHECK_IN', cp.version);
  await assert.rejects(
    attendance.scan(
      token,
      user,
      {
        latitude: 30,
        longitude: 30,
        accuracy: 5,
        timestamp: Date.now(),
        challengeId: nonce.id,
      },
      participant.id,
    ),
  );
  nonce = await challenge('CHECK_IN', cp.version);
  const position = {
    latitude: 0,
    longitude: 0,
    accuracy: 5,
    timestamp: Date.now(),
    challengeId: nonce.id,
  };
  assert.equal(
    (await attendance.scan(token, user, position, participant.id)).success,
    true,
  );
  await assert.rejects(attendance.scan(token, user, position, participant.id));
  nonce = await challenge('CHECK_IN', cp.version);
  assert.equal(
    (
      await attendance.scan(
        token,
        user,
        { ...position, challengeId: nonce.id },
        participant.id,
      )
    ).success,
    false,
  );
  await assert.rejects(events.delete(event.id, 1));
  await checkpoints.close(event.id, 'CHECK_IN');
  await checkpoints.open(event.id, 'CHECK_OUT');
  cp = await checkpoints.getOpen(event.id, 'CHECK_OUT');
  token = (
    await qr.generate({
      eventId: event.id,
      checkpoint: 'CHECK_OUT',
      checkpointVersion: cp.version,
      checkpointId: cp.id,
    })
  ).qrToken;
  nonce = await challenge('CHECK_OUT', cp.version);
  await attendance.scan(
    token,
    user,
    { ...position, timestamp: Date.now(), challengeId: nonce.id },
    participant.id,
  );
  const cert = await client.certificate.findUniqueOrThrow({
    where: { participantId: participant.id },
    include: { artifact: true },
  });
  assert.equal(cert.studentRa, null);
  assert.equal(cert.studentAccountId, null);
  const snapshot = cert.payloadSnapshot as unknown as CertificateSnapshot;
  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.role, 'ATTENDEE');
  assert.equal(JSON.stringify(snapshot).includes('@example.invalid'), false);
  const sentBefore = sent;
  await Promise.all([
    jobs.process(cert.artifact!.id),
    jobs.process(cert.artifact!.id),
  ]);
  await jobs.process(cert.artifact!.id);
  const file = await operations.download(cert.id, registration.visitorId);
  assert.equal(file.buffer.subarray(0, 4).toString(), '%PDF');
  assert.equal(sent, sentBefore + 1);
  if (process.env.PUBLIC_EVENTS_PDF_EVIDENCE)
    writeFileSync(process.env.PUBLIC_EVENTS_PDF_EVIDENCE, file.buffer);
  const hash = createHash('sha256').update(file.buffer).digest('hex');
  await catalog.template(
    {
      name: `Modelo ${run}`,
      role: 'ATTENDEE',
      heading: 'NOVA VERSÃO',
      edition: 'Edição alterada',
    },
    1,
  );
  assert.equal(
    createHash('sha256')
      .update(
        (await operations.download(cert.id, registration.visitorId))
          .buffer,
      )
      .digest('hex'),
    hash,
  );
  assert.equal(
    (await certificates.verifyCertificate(cert.verificationCode)).valid,
    true,
  );
  const speakerRegistration = await visitors.register(
    {
      seriesId: edition.id,
      name: 'Palestrante visitante',
      email: `speaker-${run}@example.invalid`,
    },
    run,
  );
  const speakerParticipant = await visitors.participant(
    speakerRegistration.visitorId,
    event.id,
  );
  await operations.assignRole(
    speakerParticipant.id,
    'SPEAKER',
    'Papel validado presencialmente pela Secretaria',
    1,
  );
  await operations.manual(
    event.id,
    {
      participantId: speakerParticipant.id,
      checkpoint: 'CHECK_IN',
      reason: 'Entrada presencial validada pelo operador',
    },
    1,
  );
  await operations.manual(
    event.id,
    {
      participantId: speakerParticipant.id,
      checkpoint: 'CHECK_OUT',
      reason: 'Saída presencial validada pelo operador',
    },
    1,
  );
  const speakerCert = await client.certificate.findUniqueOrThrow({
    where: { participantId: speakerParticipant.id },
    include: { artifact: true },
  });
  assert.equal(
    (speakerCert.payloadSnapshot as unknown as CertificateSnapshot).role,
    'SPEAKER',
  );
  assert.equal(
    (speakerCert.payloadSnapshot as unknown as CertificateSnapshot).template
      ?.id,
    speaker.id,
  );
  assert.equal(
    await client.certificate.count({ where: { eventId: event.id } }),
    2,
  );
  await jobs.process(speakerCert.artifact!.id);
  const parsePdf = require('pdf-parse') as (
    buffer: Buffer,
  ) => Promise<{ text: string }>;
  assert.match(
    (
      await parsePdf(
        (
          await operations.download(
            speakerCert.id,
            speakerRegistration.visitorId,
          )
        ).buffer,
      )
    ).text,
    /ministrou a palestra/,
  );
  const secondActivity = await events.create(
    {
      title: 'Segunda atividade de teste',
      speaker: 'Palestrante fictício',
      location: 'Local de teste',
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 3600000).toISOString(),
      workloadMinutes: 60,
    },
    event.createdById!,
  );
  await catalog.configure(secondActivity.id, config, 1);
  const secondParticipant = await visitors.participant(
    registration.visitorId,
    secondActivity.id,
  );
  assert.notEqual(secondParticipant.id, participant.id);
  await operations.manual(
    secondActivity.id,
    {
      participantId: secondParticipant.id,
      checkpoint: 'CHECK_IN',
      reason: 'Entrada presencial de teste em outra atividade',
    },
    1,
  );
  await operations.manual(
    secondActivity.id,
    {
      participantId: secondParticipant.id,
      checkpoint: 'CHECK_OUT',
      reason: 'Saída presencial de teste em outra atividade',
    },
    1,
  );
  assert.equal(
    await client.certificate.count({
      where: { participant: { visitorId: registration.visitorId } },
    }),
    2,
  );
  await assert.rejects(
    operations.assignRole(
      participant.id,
      'SPEAKER',
      'Alteração posterior proibida',
      1,
    ),
  );
  await client.eventCheckpoint.update({
    where: { id: cp.id },
    data: { closesAt: new Date(Date.now() - 1000) },
  });
  await assert.rejects(checkpoints.getOpen(event.id, 'CHECK_OUT'));
  await jobs.closeWindows();
  assert.equal(
    (await client.event.findUniqueOrThrow({ where: { id: event.id } })).status,
    'COMPLETED',
  );
  assert.equal(await operations.purge(edition.id), false);
  await client.eventSeries.update({
    where: { id: edition.id },
    data: {
      startsAt: new Date(Date.now() - 40 * 86400000),
      endsAt: new Date(Date.now() - 31 * 86400000),
      retentionAt: new Date(Date.now() - 86400000),
    },
  });
  assert.equal(await operations.purge(edition.id), true);
  assert.equal(await operations.purge(edition.id), false);
  const purged = await client.visitorRegistration.findUniqueOrThrow({
    where: { id: registration.visitorId },
  });
  for (const key of ['email', 'emailHash', 'cpfHash', 'otpHash'] as const)
    assert.equal(purged[key], null);
  await assert.rejects(visitors.session(session.token));
  assert.equal(
    (await certificates.verifyCertificate(cert.verificationCode)).valid,
    true,
  );
  await events.cancel(
    event.id,
    'Cancelamento de teste com histórico preservado',
    1,
  );
  assert.ok(
    (
      await client.certificate.findUniqueOrThrow({
        where: { id: speakerCert.id },
      })
    ).revokedAt,
  );
  assert.equal(
    (await certificates.verifyCertificate(cert.verificationCode)).valid,
    false,
  );
  await assert.rejects(operations.download(cert.id));
  const orphanKey = `event-certificates/${randomUUID()}.pdf`;
  files.set(orphanKey, Buffer.from('orphan-test'));
  await client.eventAsset.create({
    data: {
      kind: 'PDF_PENDING',
      storageKey: orphanKey,
      sha256: 'test-only',
      createdAt: new Date(Date.now() - 2 * 86400000),
    },
  });
  const kept = await client.certificateArtifact.findUniqueOrThrow({
    where: { certificateId: cert.id },
  });
  await client.eventAsset.create({
    data: {
      kind: 'PDF_PENDING',
      storageKey: kept.storageKey!,
      sha256: kept.sha256!,
      createdAt: new Date(Date.now() - 2 * 86400000),
    },
  });
  await jobs.cleanupOrphans();
  assert.equal(files.has(orphanKey), false);
  assert.equal(files.has(kept.storageKey!), true);
  console.log(
    'PASS: migrations, OTP único, visitante sem Student, GPS, nonce, janelas, presença, PDF, versão imutável, histórico, expurgo e revogação. E-mail/storage substituídos apenas neste teste.',
  );
}
void main().finally(() => client.$disconnect());
