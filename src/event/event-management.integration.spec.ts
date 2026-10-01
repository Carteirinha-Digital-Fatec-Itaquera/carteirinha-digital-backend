/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
// Teste de integração de gestão de eventos (Issue #40) contra PostgreSQL real.
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
import { EventController } from './event.controller';
import { EventService } from './event.service';
import { CheckpointService } from './checkpoint.service';
import { QrTokenService } from './qr-token.service';
import {
  AttendanceController,
  EventAttendanceController,
} from '../attendance/attendance.controller';
import { AttendanceService } from '../attendance/attendance.service';
import { AttendanceQrReferenceService } from '../attendance/attendance-qr-reference.service';
import {
  CertificateController,
  CertificateVerificationController,
} from '../certificate/certificate.controller';
import { CertificateService } from '../certificate/certificate.service';
import { PdfGeneratorService } from '../certificate/pdf-generator.service';

const url = process.env.EVENT_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration(
  'Event Management & Cancellation Integration (Real PostgreSQL)',
  () => {
    let prisma: PrismaClient;
    let app: INestApplication;
    let jwt: JwtService;
    let secretaryToken: string;
    let secretary2Token: string;
    let studentToken: string;
    let secretaryId: number;
    let secretary2Id: number;
    let studentRa: string;
    let studentAccountId: string;

    const http = () => request(app.getHttpServer() as Server);

    beforeAll(async () => {
      const target = new URL(url!);
      if (
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        !target.pathname.startsWith('/issue40_')
      ) {
        throw new Error('Use um banco local dedicado issue40_*');
      }

      process.env.JWT_SECRET = 'event-mgmt-integration-login-secret';
      process.env.ATTENDANCE_QR_SECRET = 'event-mgmt-integration-qr-secret';

      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      });

      const moduleRef = await Test.createTestingModule({
        imports: [JwtModule.register({ secret: process.env.JWT_SECRET })],
        controllers: [
          EventController,
          AttendanceController,
          EventAttendanceController,
          CertificateController,
          CertificateVerificationController,
        ],
        providers: [
          AuthGuard,
          RolesGuard,
          EventService,
          CheckpointService,
          QrTokenService,
          AttendanceService,
          AttendanceQrReferenceService,
          CertificateService,
          PdfGeneratorService,
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
      );
      await app.init();

      jwt = moduleRef.get(JwtService);

      // Setup secretárias e aluno para testes
      const sec1 = await prisma.secretary.create({
        data: {
          name: 'Secretária Teste 1',
          email: `sec1_${randomUUID()}@example.test`,
          password: 'hash',
          birthDate: new Date('1990-01-01'),
          dueDate: new Date('2030-01-01'),
        },
      });
      secretaryId = sec1.id;
      secretaryToken = jwt.sign({ sub: secretaryId, role: 'secretary' });

      const sec2 = await prisma.secretary.create({
        data: {
          name: 'Secretária Teste 2',
          email: `sec2_${randomUUID()}@example.test`,
          password: 'hash',
          birthDate: new Date('1990-01-01'),
          dueDate: new Date('2030-01-01'),
        },
      });
      secretary2Id = sec2.id;
      secretary2Token = jwt.sign({ sub: secretary2Id, role: 'secretary' });

      studentRa = 'RA' + Math.floor(100000 + Math.random() * 900000);
      studentAccountId = 'acc_' + randomUUID();

      await prisma.student.create({
        data: {
          ra: studentRa,
          name: 'Aluno Teste Integrado',
          email: `student_${studentRa}@example.test`,
          course: 'Desenvolvimento de Software Multiplataforma',
          cpf: String(Math.floor(10000000000 + Math.random() * 89999999999)),
          status: 'Ativo',
          admission: '20261',
          accountId: studentAccountId,
          dueDate: new Date('2030-01-01'),
          password: 'unused',
        },
      });

      studentToken = jwt.sign({
        sub: studentRa,
        role: 'student',
        accountId: studentAccountId,
      });
    });

    afterAll(async () => {
      if (app) await app.close();
      if (prisma) await prisma.$disconnect();
    });

    it('fluxo completo: criar -> editar -> presença -> certificado -> cancelamento revoga certificados e bloqueia PDF', async () => {
      // 1. Criar evento
      const createRes = await http()
        .post('/events')
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({
          title: 'Semana de Tecnologia 2026',
          description: 'Palestras e oficinas',
          speaker: 'Especialista Convidado',
          location: 'Auditório Principal',
          startsAt: '2026-11-10T19:00:00.000Z',
          endsAt: '2026-11-10T21:00:00.000Z',
          workloadMinutes: 120,
          certificateEnabled: true,
        })
        .expect(201);

      const eventId = createRes.body.id as string;
      expect(createRes.body.status).toBe('SCHEDULED');
      expect(createRes.body.cancelReason).toBeNull();

      // 2. Editar antes de presença
      const updateRes = await http()
        .patch(`/events/${eventId}`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({
          title: 'Semana de Tecnologia 2026 - Edição Atualizada',
          endsAt: '2026-11-10T22:00:00.000Z',
        })
        .expect(200);

      expect(updateRes.body.title).toBe(
        'Semana de Tecnologia 2026 - Edição Atualizada',
      );

      // 3. Abrir CHECK_IN e realizar check-in
      await http()
        .post(`/events/${eventId}/checkpoints/check-in/open`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .expect(200);

      const qrCheckInRes = await http()
        .get(`/events/${eventId}/checkpoints/check-in/qr`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .expect(200);

      const checkInToken = qrCheckInRes.body.qrToken as string;

      await http()
        .post('/attendances/scan')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ qrToken: checkInToken })
        .expect(200);

      // Fechar CHECK_IN
      await http()
        .post(`/events/${eventId}/checkpoints/check-in/close`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .expect(200);

      // 4. Abrir CHECK_OUT e realizar check-out
      await http()
        .post(`/events/${eventId}/checkpoints/check-out/open`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .expect(200);

      const qrCheckOutRes = await http()
        .get(`/events/${eventId}/checkpoints/check-out/qr`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .expect(200);

      await http()
        .post('/attendances/scan')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ qrToken: qrCheckOutRes.body.qrToken })
        .expect(200);

      // Fechar CHECK_OUT
      await http()
        .post(`/events/${eventId}/checkpoints/check-out/close`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .expect(200);

      // 5. Edição cadastral agora deve ser bloqueada (409) pois há presença
      await http()
        .patch(`/events/${eventId}`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({ title: 'Tentativa de mudar título após presença' })
        .expect(409);

      // 6. Aluno consulta certificados e emite se disponível
      const attendanceRecord = await prisma.attendance.findUnique({
        where: { eventId_studentRa: { eventId, studentRa } },
      });
      expect(attendanceRecord).toBeDefined();

      // 6. Certificado foi automaticamente emitido na confirmação de presença (checkout)
      const cert = await prisma.certificate.findFirst({
        where: { eventId, studentRa },
      });
      expect(cert).toBeDefined();
      expect(cert!.revokedAt).toBeNull();

      // 7. Verificação pública retorna válido
      const verifyValid = await http()
        .get(`/certificates/verify/${cert!.verificationCode}`)
        .expect(200);
      expect(verifyValid.body.valid).toBe(true);

      // 8. Download de PDF retorna 200
      await http()
        .get(`/certificates/${cert!.id}/pdf`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      // 9. Cancelar o evento via POST /events/:id/cancel
      const cancelRes = await http()
        .post(`/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({ reason: 'Auditório sofreu alagamento e evento foi suspenso' })
        .expect(200);

      expect(cancelRes.body.status).toBe('CANCELLED');
      expect(cancelRes.body.cancelReason).toBe(
        'Auditório sofreu alagamento e evento foi suspenso',
      );
      expect(cancelRes.body.cancelledById).toBe(secretaryId);
      expect(cancelRes.body.cancelledAt).toBeDefined();

      // 10. Checkpoints devem estar fechados
      const checkpoints = await prisma.eventCheckpoint.findMany({
        where: { eventId },
      });
      expect(checkpoints.every((cp) => !cp.isOpen)).toBe(true);

      // 11. Certificado foi automaticamente revogado!
      const reloadedCert = await prisma.certificate.findUnique({
        where: { id: cert!.id },
      });
      expect(reloadedCert?.revokedAt).not.toBeNull();

      // 12. Verificação pública retorna revogado
      const verifyRevoked = await http()
        .get(`/certificates/verify/${cert!.verificationCode}`)
        .expect(200);
      expect(verifyRevoked.body.valid).toBe(false);
      expect(verifyRevoked.body.revoked).toBe(true);

      // 13. Download do PDF deve retornar 409 após revogação
      await http()
        .get(`/certificates/${cert!.id}/pdf`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(409);

      // 14. Repetição do cancelamento com outra secretária e outro motivo
      const repeatCancelRes = await http()
        .post(`/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${secretary2Token}`)
        .send({ reason: 'Outro motivo que deve ser ignorado' })
        .expect(200);

      // Preserva o primeiro motivo, data e autor
      expect(repeatCancelRes.body.cancelReason).toBe(
        'Auditório sofreu alagamento e evento foi suspenso',
      );
      expect(repeatCancelRes.body.cancelledById).toBe(secretaryId);
      expect(repeatCancelRes.body.cancelledAt).toBe(cancelRes.body.cancelledAt);
    });

    it('validações de erro: motivo curto, autorização, legado misturado e cancelReason sem status', async () => {
      const createRes = await http()
        .post('/events')
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({
          title: 'Evento para teste de validação',
          speaker: 'Palestrante',
          location: 'Sala 10',
          startsAt: '2026-12-01T10:00:00.000Z',
          endsAt: '2026-12-01T12:00:00.000Z',
          workloadMinutes: 120,
        })
        .expect(201);

      const eventId = createRes.body.id as string;

      // 400 motivo curto (<3)
      await http()
        .post(`/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({ reason: 'ab' })
        .expect(400);

      // 403 aluno
      await http()
        .post(`/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ reason: 'Motivo válido pelo aluno' })
        .expect(403);

      // 400 PATCH misturando status CANCELLED com título
      await http()
        .patch(`/events/${eventId}`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({
          status: 'CANCELLED',
          cancelReason: 'Motivo válido',
          title: 'Título indevido',
        })
        .expect(400);

      // 400 PATCH com cancelReason sem status CANCELLED
      await http()
        .patch(`/events/${eventId}`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({ cancelReason: 'Apenas motivo' })
        .expect(400);

      // 400 PATCH com status CANCELLED sem motivo
      await http()
        .patch(`/events/${eventId}`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({ status: 'CANCELLED' })
        .expect(400);

      // 404 ID inexistente
      await http()
        .post(`/events/${randomUUID()}/cancel`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({ reason: 'Evento inexistente' })
        .expect(404);
    });

    it('rollback atômico se falhar a revogação de certificados (indução de erro via trigger)', async () => {
      // 1. Criar evento com certificado
      const createRes = await http()
        .post('/events')
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({
          title: 'Evento com rollback de trigger',
          speaker: 'Palestrante',
          location: 'Sala 1',
          startsAt: '2026-12-05T10:00:00.000Z',
          endsAt: '2026-12-05T12:00:00.000Z',
          workloadMinutes: 120,
        })
        .expect(201);

      const eventId = createRes.body.id as string;

      const dummyAttendance = await prisma.attendance.create({
        data: {
          eventId,
          studentRa,
          studentAccountId,
          studentName: 'Aluno Teste',
          studentCourse: 'DSM',
        },
      });

      await prisma.certificate.create({
        data: {
          eventId,
          studentRa,
          studentAccountId,
          attendanceId: dummyAttendance.id,
          verificationCode: `FATEC-EVT-TRIG-${randomUUID().slice(0, 6).toUpperCase()}`,
          payloadSnapshot: { test: true },
        },
      });

      // 2. Criar trigger que falha ao atualizar certificado deste evento
      await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_cert_update() RETURNS trigger AS $$
      BEGIN
        IF NEW."eventId" = '${eventId}' THEN
          RAISE EXCEPTION 'Simulated trigger failure for rollback test';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER cert_update_fail_trigger
      BEFORE UPDATE ON "Certificate"
      FOR EACH ROW
      EXECUTE FUNCTION fail_cert_update();
    `);

      try {
        // 3. Tenta cancelar o evento — deve falhar e dar rollback completo
        await http()
          .post(`/events/${eventId}/cancel`)
          .set('Authorization', `Bearer ${secretaryToken}`)
          .send({ reason: 'Tentativa de cancelamento com trigger falhando' })
          .expect(500);

        // 4. Verifica que o evento NÃO foi cancelado no banco
        const eventAfter = await prisma.event.findUnique({
          where: { id: eventId },
        });
        expect(eventAfter?.status).toBe('SCHEDULED');
        expect(eventAfter?.cancelReason).toBeNull();
        expect(eventAfter?.cancelledAt).toBeNull();

        // 5. Verifica que o certificado NÃO foi revogado
        const certAfter = await prisma.certificate.findFirst({
          where: { eventId },
        });
        expect(certAfter?.revokedAt).toBeNull();
      } finally {
        // Limpeza do trigger
        await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS cert_update_fail_trigger ON "Certificate";
        DROP FUNCTION IF EXISTS fail_cert_update();
      `);
      }
    });

    it('exclusão da secretária que cancelou o evento mantém dados históricos e define cancelledById como NULL', async () => {
      // Cria secretária temporária
      const tempSec = await prisma.secretary.create({
        data: {
          name: 'Secretária Temporária',
          email: `temp_${randomUUID()}@example.test`,
          password: 'hash',
          birthDate: new Date('1990-01-01'),
          dueDate: new Date('2030-01-01'),
        },
      });
      const tempToken = jwt.sign({ sub: tempSec.id, role: 'secretary' });

      const createRes = await http()
        .post('/events')
        .set('Authorization', `Bearer ${tempToken}`)
        .send({
          title: 'Evento para teste de SetNull de secretária',
          speaker: 'Palestrante',
          location: 'Auditório 2',
          startsAt: '2026-12-10T14:00:00.000Z',
          endsAt: '2026-12-10T16:00:00.000Z',
          workloadMinutes: 120,
        })
        .expect(201);

      const eventId = createRes.body.id as string;

      // Cancela com a secretária temporária
      await http()
        .post(`/events/${eventId}/cancel`)
        .set('Authorization', `Bearer ${tempToken}`)
        .send({ reason: 'Motivo cancelamento auditoria SetNull' })
        .expect(200);

      // Deleta a secretária temporária
      await prisma.secretary.delete({
        where: { id: tempSec.id },
      });

      // O evento continua existindo com motivo e data intactos, mas cancelledById = null
      const eventAfterDelete = await prisma.event.findUnique({
        where: { id: eventId },
      });
      expect(eventAfterDelete).toBeDefined();
      expect(eventAfterDelete?.status).toBe('CANCELLED');
      expect(eventAfterDelete?.cancelReason).toBe(
        'Motivo cancelamento auditoria SetNull',
      );
      expect(eventAfterDelete?.cancelledAt).not.toBeNull();
      expect(eventAfterDelete?.cancelledById).toBeNull();
      expect(eventAfterDelete?.createdById).toBeNull();
    });

    it('concorrência controlada: cancelamento e operações concorrentes não causam deadlock e preservam integridade', async () => {
      const secondPrisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      });
      try {
        // 1. Cria evento
        const createRes = await http()
          .post('/events')
          .set('Authorization', `Bearer ${secretaryToken}`)
          .send({
            title: 'Evento Concorrência Controlada',
            speaker: 'Palestrante Concorrente',
            location: 'Sala 99',
            startsAt: '2026-12-20T10:00:00.000Z',
            endsAt: '2026-12-20T12:00:00.000Z',
            workloadMinutes: 120,
          })
          .expect(201);
        const concId = createRes.body.id as string;

        // 2. Barreira concorrente: cancelamento vs edição de evento
        await Promise.allSettled([
          http()
            .post(`/events/${concId}/cancel`)
            .set('Authorization', `Bearer ${secretaryToken}`)
            .send({ reason: 'Cancelamento sob concorrência controlada' }),
          http()
            .patch(`/events/${concId}`)
            .set('Authorization', `Bearer ${secretaryToken}`)
            .send({ title: 'Tentativa de edição concorrente' }),
        ]);

        // 3. O estado final deve ser CANCELLED, sem inconsistências ou deadlock
        const finalEvent = await prisma.event.findUnique({
          where: { id: concId },
          include: { checkpoints: true },
        });
        expect(finalEvent?.status).toBe('CANCELLED');
        expect(finalEvent?.cancelReason).toBe(
          'Cancelamento sob concorrência controlada',
        );
        expect(finalEvent?.checkpoints.every((cp) => !cp.isOpen)).toBe(true);
      } finally {
        await secondPrisma.$disconnect();
      }
    });
  },
);
