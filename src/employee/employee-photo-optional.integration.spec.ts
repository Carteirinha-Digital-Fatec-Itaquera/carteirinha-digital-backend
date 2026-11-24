import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { EmployeeModule } from './employee.module';
import { SupportModule } from '../support/support.module';
import { InstitutionModule } from '../institution/institution.module';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { UploadService } from '../upload/upload.service';
type Identity = { id: string; accountId: string; version: number };
type Uploaded = { photoId: string; version: number };
type State = {
  approved: { id: string } | null;
  pending: unknown;
  latestAttempt: {
    photoId: string;
    reviewStatus: string;
    reviewReason: string | null;
  };
  version: number;
};
type Card = {
  credential: { valid: boolean; reasonCode: string | null };
  qrcode: string;
};
const body = <T>(response: { body: unknown }) => response.body as T;
describe('Avaliação de fotos com motivo opcional — HTTP/PostgreSQL descartável', () => {
  let app: INestApplication,
    prisma: PrismaService,
    jwt: JwtService,
    http: Server,
    token: string,
    image: Buffer;
  const employeeIds: string[] = [];
  const storage = new Map<string, Buffer>();
  beforeAll(async () => {
    const url = new URL(process.env.EMPLOYEE_TEST_DATABASE_URL || '');
    if (
      url.hostname !== '127.0.0.1' ||
      !url.pathname.startsWith('/disposable_employee_') ||
      process.env.DATABASE_URL !== url.href ||
      process.env.DIRECT_URL !== url.href
    )
      throw Error('Somente banco PostgreSQL local descartável explícito');
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: process.env.JWT_SECRET,
          signOptions: { expiresIn: '1h' },
        }),
        EmployeeModule,
        SupportModule,
        InstitutionModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(new PrismaService())
      .overrideProvider(MailService)
      .useValue({
        sendEmployeeAccessEmail: () =>
          Promise.reject(new Error('Envio de e-mail proibido neste teste')),
      })
      .overrideProvider(UploadService)
      .useValue({
        uploadPrivateEmployeePhoto: (bytes: Buffer, key: string) => {
          storage.set(key, bytes);
          return Promise.resolve();
        },
        getPrivateEmployeePhotoBuffer: (key: string) => {
          const bytes = storage.get(key);
          if (!bytes) throw Error('Imagem isolada não encontrada');
          return Promise.resolve({ buffer: bytes, contentType: 'image/png' });
        },
        deletePrivateEmployeePhoto: (key: string) => {
          storage.delete(key);
          return Promise.resolve();
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
    http = app.getHttpServer() as Server;
    prisma = module.get(PrismaService);
    jwt = module.get(JwtService);
    const secretary = await prisma.secretary.create({
      data: {
        name: 'Secretaria Sintética',
        email: randomUUID() + '@example.test',
        password: randomUUID(),
        birthDate: new Date('1990-01-01'),
        dueDate: new Date('2030-12-31'),
      },
    });
    token = jwt.sign({ sub: secretary.id, role: 'secretary' });
    image = await sharp({
      create: { width: 32, height: 48, channels: 3, background: '#276575' },
    })
      .png()
      .toBuffer();
  }, 180000);
  afterAll(async () => {
    if (prisma) {
      await prisma.employeeAudit.deleteMany({
        where: { employeeId: { in: employeeIds } },
      });
      await prisma.employeeAccessToken.deleteMany({
        where: { employeeId: { in: employeeIds } },
      });
      await prisma.employeePhoto.deleteMany({
        where: { employeeId: { in: employeeIds } },
      });
      await prisma.employeeAssignment.deleteMany({
        where: { employeeId: { in: employeeIds } },
      });
      await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
      await prisma.$disconnect();
    }
    if (app) await app.close();
  });
  async function create() {
    const response = await request(http)
      .post('/funcionarios')
      .auth(token, { type: 'bearer' })
      .send({
        requestId: randomUUID(),
        name: 'Pessoa Sintética',
        email: randomUUID() + '@example.test',
        registrationNumber: 'OPC-' + randomUUID(),
        admissionDate: '2024-01-01',
        assignments: [{ title: 'Docente' }],
      })
      .expect(201);
    const profile = body<Identity>(response);
    employeeIds.push(profile.id);
    return profile;
  }
  const upload = (profile: Identity, version: number) =>
    request(http)
      .post('/funcionarios/' + profile.id + '/foto')
      .auth(token, { type: 'bearer' })
      .field('requestId', randomUUID())
      .field('expectedVersion', String(version))
      .attach('file', image, 'sintetica.png')
      .expect(201);
  const review = (
    profile: Identity,
    photoId: string,
    version: number,
    reason: unknown,
    approved = false,
  ) =>
    request(http)
      .patch('/funcionarios/' + profile.id + '/fotos/' + photoId + '/avaliacao')
      .auth(token, { type: 'bearer' })
      .send({
        expectedVersion: version,
        approved,
        ...(reason === undefined ? {} : { reason }),
      });
  const access = (profile: Identity) =>
    jwt.sign({
      sub: profile.id,
      accountId: profile.accountId,
      role: 'employee',
      authVersion: 1,
    });
  it.each([undefined, null, '', '  ', '\n\t'])(
    'reprova sem motivo significativo: %j',
    async (reason) => {
      const profile = await create();
      const sent = body<Uploaded>(await upload(profile, 1));
      await review(profile, sent.photoId, 2, reason).expect(200);
      const record = await prisma.employeePhoto.findUniqueOrThrow({
        where: { id: sent.photoId },
      });
      expect(record).toMatchObject({
        reviewStatus: 'REJECTED',
        reviewReason: null,
        currentPending: false,
        processingState: 'DELETE_PENDING',
      });
      const audit = await prisma.employeeAudit.findFirstOrThrow({
        where: { employeeId: profile.id, action: 'PHOTO_REJECTED' },
      });
      expect(audit.reason).toBeNull();
      expect(audit.changedFields).toMatchObject({
        photoId: sent.photoId,
        approved: false,
      });
      const status = body<State>(
        await request(http)
          .get('/funcionarios/me/foto')
          .auth(access(profile), { type: 'bearer' })
          .expect(200),
      );
      expect(status.latestAttempt).toMatchObject({
        photoId: sent.photoId,
        reviewStatus: 'REJECTED',
        reviewReason: null,
      });
      const card = body<Card>(
        await request(http)
          .get('/funcionarios/me/carteirinha')
          .auth(access(profile), { type: 'bearer' })
          .expect(200),
      );
      expect(card.credential).toMatchObject({
        valid: false,
        reasonCode: 'PHOTO_REJECTED',
      });
    },
  );
  it('preserva motivo aparado e rejeita conteúdo inválido sem registrar decisão', async () => {
    const profile = await create();
    const sent = body<Uploaded>(await upload(profile, 1));
    for (const reason of ['ab', 'x'.repeat(501), 42, {}, 'abc\u0000def'])
      await review(profile, sent.photoId, 2, reason).expect(400);
    expect(
      await prisma.employeeAudit.count({
        where: { employeeId: profile.id, action: 'PHOTO_REJECTED' },
      }),
    ).toBe(0);
    await review(
      profile,
      sent.photoId,
      2,
      '  Rosto fora do enquadramento.  ',
    ).expect(200);
    const audit = await prisma.employeeAudit.findFirstOrThrow({
      where: { employeeId: profile.id, action: 'PHOTO_REJECTED' },
    });
    expect(audit.reason).toBe('Rosto fora do enquadramento.');
  });
  it('preserva permissões, versão e rejeição da substituta sem perder aprovação anterior', async () => {
    const profile = await create();
    const approved = body<Uploaded>(await upload(profile, 1));
    await review(profile, approved.photoId, 2, undefined, true).expect(200);
    const replacement = body<Uploaded>(await upload(profile, 3));
    const route =
      '/funcionarios/' +
      profile.id +
      '/fotos/' +
      replacement.photoId +
      '/avaliacao';
    await request(http)
      .patch(route)
      .send({ expectedVersion: 4, approved: false })
      .expect(401);
    await request(http)
      .patch(route)
      .auth(access(profile), { type: 'bearer' })
      .send({ expectedVersion: 4, approved: false })
      .expect(403);
    await review(profile, replacement.photoId, 3, undefined).expect(409);
    expect(
      await prisma.employeeAudit.count({
        where: { employeeId: profile.id, action: 'PHOTO_REJECTED' },
      }),
    ).toBe(0);
    const decisions = await Promise.all([
      review(profile, replacement.photoId, 4, undefined),
      review(profile, replacement.photoId, 4, null),
    ]);
    expect(decisions.map((r) => r.status).sort()).toEqual([200, 409]);
    const status = body<State>(
      await request(http)
        .get('/funcionarios/me/foto')
        .auth(access(profile), { type: 'bearer' })
        .expect(200),
    );
    expect(status.approved?.id).toBe(approved.photoId);
    expect(status.pending).toBeNull();
    expect(status.latestAttempt.reviewReason).toBeNull();
    const card = body<Card>(
      await request(http)
        .get('/funcionarios/me/carteirinha')
        .auth(access(profile), { type: 'bearer' })
        .expect(200),
    );
    expect(card.credential.valid).toBe(true);
    expect(
      body<{ valid: boolean }>(
        await request(http)
          .get('/funcionarios/verificar/' + card.qrcode)
          .expect(200),
      ).valid,
    ).toBe(true);
    expect(
      await prisma.employeeAudit.count({
        where: { employeeId: profile.id, action: 'PHOTO_REJECTED' },
      }),
    ).toBe(1);
  });
});
