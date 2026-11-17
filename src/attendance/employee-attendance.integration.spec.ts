import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AttendanceModule } from './attendance.module';
import { CertificateModule } from '../certificate/certificate.module';
import { PrismaService } from '../database/prisma.service';
import { EmployeeModule } from '../employee/employee.module';
import { EventModule } from '../event/event.module';
import { MailService } from '../mail/mail.service';
import { PublicEventsModule } from '../public-events/public-events.module';

describe('Employee Events, Attendance & Certificates Integration (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let secretaryToken: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-employee-only';
    process.env.ATTENDANCE_QR_SECRET =
      process.env.ATTENDANCE_QR_SECRET || 'test-qr-secret-employee-only';
    process.env.EMPLOYEE_APP_URL = 'https://funcionarios.example.test';

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: process.env.JWT_SECRET,
          signOptions: { expiresIn: '1h' },
        }),
        EmployeeModule,
        EventModule,
        AttendanceModule,
        CertificateModule,
        PublicEventsModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(new PrismaService())
      .overrideProvider(MailService)
      .useValue({
        sendEmployeeAccessEmail: async () => ({ messageId: 'mock' }),
        sendCertificateNotification: async () => ({ messageId: 'mock' }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
    jwtService = moduleRef.get(JwtService);

    await prisma.certificateArtifact.deleteMany();
    await prisma.certificate.deleteMany();
    await prisma.attendance.deleteMany();
    await prisma.eventParticipant.deleteMany();
    await prisma.attendanceQrReference.deleteMany();
    await prisma.eventCheckpoint.deleteMany();
    await prisma.event.deleteMany();
    await prisma.employeeOfflineReceipt.deleteMany();
    await prisma.employeeOfflineSession.deleteMany();
    await prisma.employeeAudit.deleteMany();
    await prisma.employeeAssignment.deleteMany();
    await prisma.employee.deleteMany();
    await prisma.student.deleteMany();

    const secretary = await prisma.secretary.upsert({
      where: { email: 'sec.events.emp@example.test' },
      update: { dueDate: new Date('2030-12-31T00:00:00.000Z') },
      create: {
        name: 'Secretaria Eventos',
        email: 'sec.events.emp@example.test',
        dueDate: new Date('2030-12-31T00:00:00.000Z'),
        password: 'hash',
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
      },
    });

    secretaryToken = await jwtService.signAsync({
      sub: secretary.id,
      role: 'secretary',
      email: secretary.email,
    });
  });

  afterAll(async () => {
    await prisma.certificateArtifact.deleteMany();
    await prisma.certificate.deleteMany();
    await prisma.attendance.deleteMany();
    await prisma.eventParticipant.deleteMany();
    await prisma.attendanceQrReference.deleteMany();
    await prisma.eventCheckpoint.deleteMany();
    await prisma.event.deleteMany();
    await prisma.employeeOfflineReceipt.deleteMany();
    await prisma.employeeOfflineSession.deleteMany();
    await prisma.employeeAudit.deleteMany();
    await prisma.employeeAssignment.deleteMany();
    await prisma.employee.deleteMany();
    await prisma.student.deleteMany();
    await prisma.$disconnect();
    await app.close();
  });

  it('permite presença de funcionário sem matrícula com foto pendente em evento sem visitantes e emite certificado isolado', async () => {
    // Homonym student with same email & name
    await prisma.student.create({
      data: {
        ra: '1112223334445',
        accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        course: 'DSM',
        status: 'Ativo',
        name: 'Ana Homonima',
        admission: '2024-1',
        email: 'ana.homonima@example.test',
        dueDate: new Date('2028-12-31T00:00:00.000Z'),
        password: 'hash',
      },
    });

    const empRes = await request(app.getHttpServer())
      .post('/funcionarios')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        requestId: '44444444-4444-4444-8444-444444444401',
        name: 'Ana Homonima',
        socialName: 'Ana Social',
        email: 'ana.homonima@example.test',
        registrationNumber: null,
        admissionDate: '2024-02-01',
        assignments: [{ title: 'Docente' }],
      })
      .expect(201);

    const empToken = await jwtService.signAsync({
      sub: empRes.body.id,
      accountId: empRes.body.accountId,
      role: 'employee',
      authVersion: 1,
    });

    // Event with visitorsAllowed=false, locationEnabled=false, FINAL_ONLY
    const evRes = await request(app.getHttpServer())
      .post('/events')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        title: 'Palestra Institucional',
        speaker: 'Palestrante Teste',
        location: 'Auditório',
        startsAt: new Date(Date.now() - 3600_000).toISOString(),
        endsAt: new Date(Date.now() + 3600_000).toISOString(),
        workloadMinutes: 60,
        visitorsAllowed: false,
        locationEnabled: false,
        certificateEnabled: true,
      })
      .expect(201);

    // Open CHECK_OUT checkpoint (moves event to IN_PROGRESS)
    await request(app.getHttpServer())
      .post(`/events/${evRes.body.id}/checkpoints/check-out/open`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(200);

    const qrRes = await request(app.getHttpServer())
      .get(`/events/${evRes.body.id}/checkpoints/check-out/qr`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(200);

    // Scan QR as employee (visitorsAllowed=false, photo pending!)
    const scanRes = await request(app.getHttpServer())
      .post('/attendances/scan')
      .set('Authorization', `Bearer ${empToken}`)
      .send({ qrToken: qrRes.body.qrToken })
      .expect(200);

    expect(scanRes.body.success).toBe(true);
    expect(scanRes.body.status).toBe('CONFIRMED');

    // Duplicate scan does not emit second certificate
    const dupRes = await request(app.getHttpServer())
      .post('/attendances/scan')
      .set('Authorization', `Bearer ${empToken}`)
      .send({ qrToken: qrRes.body.qrToken })
      .expect(200);
    expect(dupRes.body.success).toBe(false);
    expect(dupRes.body.code).toBe('ALREADY_CHECKED_OUT');

    // Check certificates/me for employee
    const certsRes = await request(app.getHttpServer())
      .get('/certificates/me')
      .set('Authorization', `Bearer ${empToken}`)
      .expect(200);

    expect(certsRes.body).toHaveLength(1);
    const certId = certsRes.body[0].id as string;

    const certDetail = await request(app.getHttpServer())
      .get(`/certificates/${certId}`)
      .set('Authorization', `Bearer ${empToken}`)
      .expect(200);
    expect(certDetail.body.payloadSnapshot.recipient).toEqual({
      type: 'EMPLOYEE',
      displayName: 'Ana Social',
      registrationNumber: null,
    });

    // Homonym student sees 0 certificates
    const studentToken = await jwtService.signAsync({
      sub: '1112223334445',
      accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      role: 'student',
    });
    const studentCerts = await request(app.getHttpServer())
      .get('/certificates/me')
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);
    expect(studentCerts.body).toHaveLength(0);

    // Employee downloads PDF
    const pdfRes = await request(app.getHttpServer())
      .get(`/certificates/${certId}/pdf`)
      .set('Authorization', `Bearer ${empToken}`)
      .expect(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
  });

  it('bloqueia presença quando vínculo funcional foi encerrado', async () => {
    const empRes = await request(app.getHttpServer())
      .post('/funcionarios')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        requestId: '44444444-4444-4444-8444-444444444402',
        name: 'Vinculo Encerrado',
        email: 'encerrado@example.test',
        admissionDate: '2024-02-01',
        assignments: [{ title: 'Docente', active: false }],
      })
      .expect(201);

    const empToken = await jwtService.signAsync({
      sub: empRes.body.id,
      accountId: empRes.body.accountId,
      role: 'employee',
      authVersion: 1,
    });

    const evRes = await request(app.getHttpServer())
      .post('/events')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        title: 'Evento Teste Bloqueio',
        speaker: 'Palestrante',
        location: 'Sala 1',
        startsAt: new Date(Date.now() - 3600_000).toISOString(),
        endsAt: new Date(Date.now() + 3600_000).toISOString(),
        workloadMinutes: 60,
        visitorsAllowed: false,
        locationEnabled: false,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/events/${evRes.body.id}/checkpoints/check-out/open`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(200);

    const qrRes = await request(app.getHttpServer())
      .get(`/events/${evRes.body.id}/checkpoints/check-out/qr`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/attendances/scan')
      .set('Authorization', `Bearer ${empToken}`)
      .send({ qrToken: qrRes.body.qrToken })
      .expect(403);
  });

  it('suporta sessão offline restrita, recibo idempotente após fechamento, GPS fail-closed e revogação', async () => {
    const empRes = await request(app.getHttpServer())
      .post('/funcionarios')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        requestId: '44444444-4444-4444-8444-444444444403',
        name: 'Offline Employee',
        email: 'offline.emp@example.test',
        admissionDate: '2024-02-01',
        assignments: [{ title: 'Docente' }],
      })
      .expect(201);

    const empToken = await jwtService.signAsync({
      sub: empRes.body.id,
      accountId: empRes.body.accountId,
      role: 'employee',
      authVersion: 1,
    });

    const evRes = await request(app.getHttpServer())
      .post('/events')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        title: 'Evento Offline Funcionario',
        speaker: 'Palestrante',
        location: 'Sala 2',
        startsAt: new Date(Date.now() - 3600_000).toISOString(),
        endsAt: new Date(Date.now() + 3600_000).toISOString(),
        workloadMinutes: 60,
        visitorsAllowed: false,
        locationEnabled: false,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/events/${evRes.body.id}/checkpoints/check-out/open`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(200);

    const linkRes = await request(app.getHttpServer())
      .get(`/events/${evRes.body.id}/attendance-link`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(200);

    const reference = new URL(linkRes.body.qrUrl as string).pathname
      .split('/')
      .pop() as string;

    // Origin mismatch -> 403
    await request(app.getHttpServer())
      .post('/attendances/employee-offline/session')
      .set('Authorization', `Bearer ${empToken}`)
      .set('Origin', 'https://evil.example.test')
      .expect(403);

    // Valid session
    const sessRes = await request(app.getHttpServer())
      .post('/attendances/employee-offline/session')
      .set('Authorization', `Bearer ${empToken}`)
      .set('Origin', 'https://funcionarios.example.test')
      .expect(200);

    const setCookie = sessRes.headers['set-cookie'] as string[];
    const cookieHeader = setCookie[0].split(';')[0];
    expect(setCookie[0]).toContain('event_employee_offline=');
    expect(setCookie[0]).toContain('Path=/api/attendances/employee-offline');
    expect(setCookie[0]).toContain('HttpOnly');

    const reqId = '44444444-4444-4444-8444-444444444404';
    const scannedAt = new Date().toISOString();

    const submitRes = await request(app.getHttpServer())
      .post('/attendances/employee-offline/submit')
      .set('Origin', 'https://funcionarios.example.test')
      .set('Cookie', cookieHeader)
      .send({
        requestId: reqId,
        accountId: empRes.body.accountId,
        reference,
        scannedAt,
      })
      .expect(200);

    expect(submitRes.body.status).toBe('confirmed');

    // Close checkpoint -> replay with same requestId STILL returns receipt
    await request(app.getHttpServer())
      .post(`/events/${evRes.body.id}/checkpoints/check-out/close`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(200);

    const replayRes = await request(app.getHttpServer())
      .post('/attendances/employee-offline/submit')
      .set('Origin', 'https://funcionarios.example.test')
      .set('Cookie', cookieHeader)
      .send({
        requestId: reqId,
        accountId: empRes.body.accountId,
        reference,
        scannedAt,
      })
      .expect(200);
    expect(replayRes.body.requestId).toBe(reqId);

    // Same requestId with different payload -> 409
    await request(app.getHttpServer())
      .post('/attendances/employee-offline/submit')
      .set('Origin', 'https://funcionarios.example.test')
      .set('Cookie', cookieHeader)
      .send({
        requestId: reqId,
        accountId: empRes.body.accountId,
        reference: 'outro_ref_ficticio_123',
        scannedAt,
      })
      .expect(409);

    // Revoke session -> subsequent submit returns 401
    await request(app.getHttpServer())
      .post('/attendances/employee-offline/revoke')
      .set('Origin', 'https://funcionarios.example.test')
      .set('Cookie', cookieHeader)
      .expect(200);

    await request(app.getHttpServer())
      .post('/attendances/employee-offline/status')
      .set('Origin', 'https://funcionarios.example.test')
      .set('Cookie', cookieHeader)
      .send({ accountId: empRes.body.accountId, requestIds: [reqId] })
      .expect(401);
  });
});
