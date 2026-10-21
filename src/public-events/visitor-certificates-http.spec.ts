import type { Server } from 'node:http';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { VisitorController } from './public-events.controller';
import { VisitorService } from './visitor.service';
import { PrismaService } from '../database/prisma.service';
import { AttendanceQrReferenceService } from '../attendance/attendance-qr-reference.service';
import { AttendanceService } from '../attendance/attendance.service';
import { EventOperationsService } from './event-operations.service';

describe('HTTP de certificados do visitante', () => {
  let app: INestApplication<Server>;
  const visitors = {
    recoverCertificates: jest.fn(),
    certificateVisitorIds: jest.fn(),
    session: jest.fn(),
    bindCpf: jest.fn(),
  };
  const prisma = { certificate: { findMany: jest.fn(), findFirst: jest.fn() } };
  const operations = { download: jest.fn() };
  const origin = 'https://carteirinha-digital-front-end-aluno.vercel.app';
  const certificateId = '00000000-0000-4000-8000-000000000001';
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [VisitorController],
      providers: [
        { provide: VisitorService, useValue: visitors },
        { provide: PrismaService, useValue: prisma },
        { provide: AttendanceQrReferenceService, useValue: {} },
        { provide: AttendanceService, useValue: {} },
        { provide: EventOperationsService, useValue: operations },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => jest.resetAllMocks());
  afterAll(async () => {
    await app.close();
  });

  it('exige origem permitida e rejeita campos extras e CPF malformado', async () => {
    await request(app.getHttpServer())
      .post('/visitor/certificates/access')
      .send({ cpf: '52998224725' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/visitor/certificates/access')
      .set('Origin', origin)
      .send({ cpf: '52998224725', role: 'secretary' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/visitor/certificates/access')
      .set('Origin', origin)
      .send({ cpf: 'abc52998224725' })
      .expect(400);
    expect(visitors.recoverCertificates).not.toHaveBeenCalled();
  });

  it('define cookie HttpOnly exclusivo de certificados sem devolver o token no JSON', async () => {
    visitors.recoverCertificates.mockResolvedValue({
      token: 'a'.repeat(43),
      expiresAt: new Date(Date.now() + 3600000),
    });
    const response = await request(app.getHttpServer())
      .post('/visitor/certificates/access')
      .set('Origin', origin)
      .send({ cpf: '52998224725' })
      .expect(200);
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^event_certificates=.*HttpOnly; SameSite=Lax/),
      ]),
    );
    expect(response.body).not.toHaveProperty('token');
  });

  it('lista apenas certificados dos vínculos autorizados, recebendo cookies distintos', async () => {
    visitors.certificateVisitorIds.mockResolvedValue(['visitor-1']);
    prisma.certificate.findMany.mockResolvedValue([]);
    await request(app.getHttpServer())
      .get('/visitor/certificates')
      .set('Cookie', 'event_visitor=presence; event_certificates=read-only')
      .expect(200);
    expect(visitors.certificateVisitorIds).toHaveBeenCalledWith(
      'presence',
      'read-only',
    );
    expect(prisma.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { participant: { visitorId: { in: ['visitor-1'] } } },
      }),
    );
  });

  it('PDF de outro participante retorna 404 e nunca chama o gerador', async () => {
    visitors.certificateVisitorIds.mockResolvedValue(['visitor-1']);
    prisma.certificate.findFirst.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get(`/visitor/certificates/${certificateId}/pdf`)
      .expect(404);
    expect(operations.download).not.toHaveBeenCalled();
  });

  it('download usa o proprietário encontrado pelo filtro de autorização', async () => {
    visitors.certificateVisitorIds.mockResolvedValue(['visitor-1']);
    prisma.certificate.findFirst.mockResolvedValue({
      participant: { visitorId: 'visitor-1' },
    });
    operations.download.mockResolvedValue({
      code: 'FATEC-TEST',
      buffer: Buffer.from('%PDF-1.4\n'),
    });
    await request(app.getHttpServer())
      .get(`/visitor/certificates/${certificateId}/pdf`)
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
    expect(operations.download).toHaveBeenCalledWith(
      certificateId,
      'visitor-1',
    );
  });

  it('recuperação de certificados não autoriza check-in ou consulta da sessão de presença', async () => {
    visitors.session.mockRejectedValue(new UnauthorizedException());
    await request(app.getHttpServer())
      .get('/visitor/session')
      .set('Cookie', 'event_certificates=read-only')
      .expect(401);
    expect(visitors.session).toHaveBeenCalledWith(undefined);
  });
});
