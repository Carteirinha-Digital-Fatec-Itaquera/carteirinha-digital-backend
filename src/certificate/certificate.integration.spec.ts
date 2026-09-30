import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { Server } from 'http';
import request from 'supertest';
import { PrismaService } from '../database/prisma.service';
import { CertificateModule } from './certificate.module';
import { CertificateService } from './certificate.service';

const testDbUrl = process.env.CERTIFICATE_TEST_DATABASE_URL;
const integration = testDbUrl ? describe : describe.skip;

integration(
  'Certificate Module Integration Tests (Local Dedicated PostgreSQL)',
  () => {
    let prisma: PrismaClient;
    let app: INestApplication;
    let jwt: JwtService;
    let certificateService: CertificateService;

    let eventId: string;
    let studentRa: string;
    let studentAccountId: string;
    let studentToken: string;
    let otherStudentToken: string;
    let attendanceId: string;

    const http = () => request(app.getHttpServer() as Server);

    beforeAll(async () => {
      const target = new URL(testDbUrl!);
      if (
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        !target.pathname.startsWith('/issue27_')
      ) {
        throw new Error(
          'Por segurança, somente banco local dedicado issue27_* é aceito.',
        );
      }

      process.env.JWT_SECRET = 'cert-test-jwt-secret';
      process.env.CERTIFICATE_VERIFICATION_BASE_URL = 'http://localhost:5173';

      prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } });
      await prisma.$connect();

      const moduleRef = await Test.createTestingModule({
        imports: [
          JwtModule.register({ secret: process.env.JWT_SECRET }),
          CertificateModule,
        ],
      })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .compile();

      app = moduleRef.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
      );
      await app.init();

      jwt = moduleRef.get(JwtService);
      certificateService = moduleRef.get(CertificateService);
    });

    afterAll(async () => {
      await app?.close();
      await prisma?.$disconnect();
    });

    beforeEach(async () => {
      studentRa = `RA${Math.floor(10000000 + Math.random() * 90000000)}`;
      studentAccountId = `acc-${randomUUID()}`;

      studentToken = jwt.sign({
        sub: studentRa,
        accountId: studentAccountId,
        role: 'student',
        name: 'Aluno Titular',
      });

      otherStudentToken = jwt.sign({
        sub: `RA${Math.floor(10000000 + Math.random() * 90000000)}`,
        accountId: `acc-${randomUUID()}`,
        role: 'student',
        name: 'Outro Aluno',
      });

      // 1. Criar estudante
      await prisma.student.create({
        data: {
          ra: studentRa,
          name: 'Aluno Titular Teste',
          email: `aluno-${studentRa}@fatec.sp.gov.br`,
          course: 'DSM',
          password: 'hashed-password',
          accountId: studentAccountId,
          status: 'Ativo',
        },
      });

      // 2. Criar evento com certificado habilitado
      const event = await prisma.event.create({
        data: {
          title: 'Workshop de Testes de Integração',
          speaker: 'Instrutor Teste',
          location: 'Lab 1',
          startsAt: new Date(Date.now() + 3600000),
          endsAt: new Date(Date.now() + 7200000),
          workloadMinutes: 120,
          status: 'COMPLETED',
          certificateEnabled: true,
        },
      });
      eventId = event.id;

      // 3. Criar presença confirmada
      const attendance = await prisma.attendance.create({
        data: {
          eventId,
          studentRa,
          studentName: 'Aluno Titular Teste',
          studentCourse: 'DSM',
          studentAccountId,
          studentRefRa: studentRa,
          checkInAt: new Date(Date.now() - 7200000),
          checkOutAt: new Date(Date.now() - 3600000),
          status: 'CONFIRMED',
        },
      });
      attendanceId = attendance.id;
    });

    it('concurrency: 20 concurrent issueCertificate calls return the exact same certificate ID', async () => {
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          certificateService.issueCertificate(attendanceId),
        ),
      );

      const ids = new Set(results.map((r) => r?.id));
      expect(ids.size).toBe(1);

      const count = await prisma.certificate.count({ where: { attendanceId } });
      expect(count).toBe(1);

      expect(results[0]?.verificationCode).toMatch(
        /^FATEC-EVT-[0-9A-HJKMNP-TV-Z]{16}$/,
      );
    });

    it('history and deletion: student deletion sets studentRefRa to null but preserves Certificate and public verification', async () => {
      const cert = await certificateService.issueCertificate(attendanceId);
      expect(cert).toBeDefined();

      // Excluir aluno
      await prisma.student.delete({ where: { ra: studentRa } });

      // O certificado deve continuar existindo com studentRefRa nulo
      const certAfter = await prisma.certificate.findUnique({
        where: { id: cert.id },
      });
      expect(certAfter).toBeDefined();
      expect(certAfter?.studentRefRa).toBeNull();

      // Verificação pública continua funcionando com snapshot imutável
      const publicVerify = await http()
        .get(`/certificates/verify/${cert.verificationCode}`)
        .expect(200);

      expect(publicVerify.body).toMatchObject({
        valid: true,
        code: cert.verificationCode,
        studentName: 'Aluno Titular Teste',
        eventTitle: 'Workshop de Testes de Integração',
      });

      // Novo download privado pelo aluno deixa de funcionar porque o cadastro não existe mais
      await http()
        .get(`/certificates/${cert.id}/pdf`)
        .auth(studentToken, { type: 'bearer' })
        .expect(403);
    });

    it('authorization: other student cannot access or download certificate of another student', async () => {
      const cert = await certificateService.issueCertificate(attendanceId);

      // Outro aluno não deve conseguir consultar por ID (404 seguro)
      await http()
        .get(`/certificates/${cert.id}`)
        .auth(otherStudentToken, { type: 'bearer' })
        .expect(404);

      // Outro aluno não deve conseguir fazer download (404 seguro)
      await http()
        .get(`/certificates/${cert.id}/pdf`)
        .auth(otherStudentToken, { type: 'bearer' })
        .expect(404);
    });
  },
);
