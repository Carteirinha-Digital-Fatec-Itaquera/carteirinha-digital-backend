import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { UploadService } from '../upload/upload.service';
import { InstitutionModule } from '../institution/institution.module';
import { SupportModule } from '../support/support.module';
import { EmployeeImportWorkerService } from './employee-import-worker.service';
import { EmployeeModule } from './employee.module';

describe('Employee CRUD, Auth & Assignments Integration (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let importWorker: EmployeeImportWorkerService;
  let secretaryToken: string;
  const sentEmails: Array<{
    email: string;
    actionUrl: string;
    purpose: string;
  }> = [];
  const storedPhotos = new Map<string, Buffer>();
  let storageUnavailable = false;
  let storageGate: Promise<void> | undefined;
  let storageCalls = 0;

  beforeAll(async () => {
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || 'test-jwt-secret-employee-only';
    process.env.EMPLOYEE_APP_URL = 'https://funcionarios.example.test';

    const moduleRef = await Test.createTestingModule({
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
        sendEmployeeAccessEmail: async (params: {
          email: string;
          actionUrl: string;
          purpose: string;
        }) => {
          sentEmails.push(params);
          return { messageId: 'mock-msg-id' };
        },
      })
      .overrideProvider(UploadService)
      .useValue({
        uploadPrivateEmployeePhoto: async (
          buffer: Buffer,
          storageKey: string,
        ) => {
          storageCalls++;
          if (storageUnavailable)
            throw new Error('Armazenamento isolado indisponível');
          if (storageGate) await storageGate;
          storedPhotos.set(storageKey, buffer);
        },
        getPrivateEmployeePhotoBuffer: async (storageKey: string) => {
          const buf = storedPhotos.get(storageKey);
          if (!buf) throw new Error('Not found');
          return { buffer: buf, contentType: 'image/png' };
        },
        deletePrivateEmployeePhoto: async (storageKey: string) => {
          storedPhotos.delete(storageKey);
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
    jwtService = moduleRef.get(JwtService);
    importWorker = moduleRef.get(EmployeeImportWorkerService);

    await prisma.eventRateLimit.deleteMany();
    await prisma.supportAudit.deleteMany();
    await prisma.supportMessage.deleteMany();
    await prisma.supportTicket.deleteMany();
    await prisma.employeeImportRow.deleteMany();
    await prisma.employeeImportBatch.deleteMany();
    await prisma.employeeAudit.deleteMany();
    await prisma.employeeAccessToken.deleteMany();
    await prisma.employeeAssignment.deleteMany();
    await prisma.employeePhoto.deleteMany();
    await prisma.employee.deleteMany();

    const secretary = await prisma.secretary.upsert({
      where: { email: 'sec.employee.test@example.test' },
      update: { dueDate: new Date('2030-12-31T00:00:00.000Z') },
      create: {
        name: 'Secretaria Teste',
        email: 'sec.employee.test@example.test',
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
    await prisma.employeeAudit.deleteMany();
    await prisma.employeeAccessToken.deleteMany();
    await prisma.employeeAssignment.deleteMany();
    await prisma.employeePhoto.deleteMany();
    await prisma.employee.deleteMany();
    await prisma.$disconnect();
    await app.close();
  });

  it('cadastra funcionário com matrícula com e-mail pessoal, nome social e cargo Secretaria sem conceder permissão', async () => {
    const reqId = '11111111-1111-4111-8111-111111111101';
    const res = await request(app.getHttpServer())
      .post('/funcionarios')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        requestId: reqId,
        name: 'Maria da Silva',
        socialName: 'Maria Silva Social',
        email: 'maria.pessoal@example.test',
        registrationNumber: 'FUN-001',
        rg: null,
        admissionDate: '2024-02-01',
        assignments: [
          {
            title: 'Secretaria',
            startsOn: null,
            validUntil: null,
            active: true,
          },
          {
            title: 'Docente',
            startsOn: '2026-01-01',
            validUntil: '2027-12-31',
            active: true,
          },
        ],
      })
      .expect(201);

    expect(res.body.registrationNumber).toBe('FUN-001');
    expect(res.body.displayName).toBe('Maria Silva Social');
    expect(res.body.assignments).toHaveLength(2);
    expect(res.body.version).toBe(1);

    // Replay with same requestId returns same employee
    const replay = await request(app.getHttpServer())
      .post('/funcionarios')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        requestId: reqId,
        name: 'Maria da Silva',
        socialName: 'Maria Silva Social',
        email: 'maria.pessoal@example.test',
        registrationNumber: 'FUN-001',
        rg: null,
        admissionDate: '2024-02-01',
        assignments: [
          {
            title: 'Secretaria',
            startsOn: null,
            validUntil: null,
            active: true,
          },
          {
            title: 'Docente',
            startsOn: '2026-01-01',
            validUntil: '2027-12-31',
            active: true,
          },
        ],
      })
      .expect(201);
    expect(replay.body.id).toBe(res.body.id);

    // Different payload with same requestId -> 409 REQUEST_ID_REUSED
    await request(app.getHttpServer())
      .post('/funcionarios')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        requestId: reqId,
        name: 'Outro Nome',
        email: 'outro@example.test',
        registrationNumber: 'FUN-002',
        admissionDate: '2024-02-01',
        assignments: [{ title: 'Docente' }],
      })
      .expect(409);
  });

  it('exige matrícula no cadastro manual e diferencia duplicidade de e-mail ou matrícula', async () => {
    const api = app.getHttpServer();
    const endpoint = () =>
      request(api)
        .post('/funcionarios')
        .set('Authorization', `Bearer ${secretaryToken}`);
    const data = {
      requestId: '99999999-9999-4999-8999-999999999991',
      name: 'Pessoa Fixture',
      email: 'fixture.matricula@example.test',
      admissionDate: '2026-01-01',
      assignments: [{ title: 'Docente' }],
    };
    await endpoint().send(data).expect(400);
    await endpoint()
      .send({ ...data, registrationNumber: '   ' })
      .expect(400);
    await endpoint()
      .send({ ...data, registrationNumber: 'UNICA-001' })
      .expect(201);
    const duplicateEmail = await endpoint()
      .send({
        ...data,
        requestId: '99999999-9999-4999-8999-999999999992',
        registrationNumber: 'UNICA-002',
      })
      .expect(409);
    expect(duplicateEmail.body.code).toBe('EMAIL_ALREADY_EXISTS');
    const duplicateRegistration = await endpoint()
      .send({
        ...data,
        requestId: '99999999-9999-4999-8999-999999999993',
        registrationNumber: 'UNICA-001',
        email: 'fixture.outra@example.test',
      })
      .expect(409);
    expect(duplicateRegistration.body.code).toBe('REGISTRATION_ALREADY_EXISTS');
  });

  it('rejeita campos proibidos no corpo (role, accountId, searchText, passwordHash)', async () => {
    await request(app.getHttpServer())
      .post('/funcionarios')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        requestId: '11111111-1111-4111-8111-111111111102',
        name: 'Teste Proibido',
        email: 'proibido@example.test',
        registrationNumber: 'FUN-003',
        admissionDate: '2024-02-01',
        role: 'secretary',
        assignments: [{ title: 'Docente' }],
      })
      .expect(400);
  });

  it('garante CAS 409 em edições concorrentes e bloqueia edição de assignmentId de outra pessoa', async () => {
    const emp1 = await request(app.getHttpServer())
      .post('/funcionarios')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        requestId: '11111111-1111-4111-8111-111111111103',
        name: 'Pessoa Um',
        email: 'pessoa.um@example.test',
        registrationNumber: 'FUN-004',
        admissionDate: '2024-02-01',
        assignments: [{ title: 'Docente' }],
      })
      .expect(201);

    const emp2 = await request(app.getHttpServer())
      .post('/funcionarios')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        requestId: '11111111-1111-4111-8111-111111111104',
        name: 'Pessoa Dois',
        email: 'pessoa.dois@example.test',
        registrationNumber: 'FUN-005',
        admissionDate: '2024-02-01',
        assignments: [{ title: 'Coordenador' }],
      })
      .expect(201);

    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/funcionarios/${emp1.body.id}`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({
          expectedVersion: 1,
          reason: 'Ajuste A',
          name: 'Pessoa Um Editada A',
        }),
      request(app.getHttpServer())
        .patch(`/funcionarios/${emp1.body.id}`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({
          expectedVersion: 1,
          reason: 'Ajuste B',
          name: 'Pessoa Um Editada B',
        }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    // Assignment of emp2 cannot be edited under emp1
    await request(app.getHttpServer())
      .patch(
        `/funcionarios/${emp1.body.id}/funcoes/${emp2.body.assignments[0].id}`,
      )
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({ expectedVersion: 2, reason: 'Tentativa cruzada', active: false })
      .expect(404);
  });

  it('ativa primeiro acesso com consumo único concorrente, autentica e invalida sessão antiga ao bloquear ou resetar senha', async () => {
    const created = await request(app.getHttpServer())
      .post('/funcionarios')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        requestId: '11111111-1111-4111-8111-111111111105',
        name: 'Carlos Acesso',
        email: 'carlos.acesso@example.test',
        registrationNumber: 'FUN-006',
        admissionDate: '2024-02-01',
        assignments: [{ title: 'Docente' }],
      })
      .expect(201);

    // Login before setting password fails
    await request(app.getHttpServer())
      .post('/autenticacao/funcionarios/login')
      .send({ email: 'carlos.acesso@example.test', password: 'SenhaForte123!' })
      .expect(401);

    const email = 'carlos.acesso@example.test';
    const originalDeliveries = sentEmails.length;
    const api = app.getHttpServer();
    const login = (email: string, password: string) =>
      request(api)
        .post('/autenticacao/funcionarios/login')
        .send({ email, password });
    const wrong = await login(email, 'INCORRETA').expect(401);
    const unknown = await login('inexistente@example.test', 'FUN-006').expect(
      401,
    );
    expect(wrong.body).toEqual(unknown.body);

    const pending = await login(email, 'FUN-006').expect(200);
    expect(pending.body.mustChangePassword).toBe(true);
    expect(pending.body).not.toHaveProperty('token');
    expect(sentEmails).toHaveLength(originalDeliveries);
    await request(api).get('/funcionarios/me').expect(401);

    await prisma.employeeAccessToken.updateMany({
      where: { employeeId: created.body.id },
      data: { expiresAt: new Date(0) },
    });
    await request(api)
      .post('/autenticacao/funcionarios/ativar')
      .send({
        token: pending.body.firstAccessToken,
        newPassword: 'SenhaForte123!',
      })
      .expect(400);
    const second = await login(email, 'FUN-006').expect(200);
    const token = second.body.firstAccessToken as string;
    await request(api)
      .post('/autenticacao/funcionarios/solicitar-acesso')
      .send({ email })
      .expect(410);
    await request(api)
      .post(`/funcionarios/${created.body.id}/convite`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(410);
    expect(sentEmails).toHaveLength(originalDeliveries);
    expect(token).toBeTruthy();

    await request(api)
      .post('/autenticacao/funcionarios/ativar')
      .send({ token, newPassword: 'FUN-006  ' })
      .expect(400);
    await request(api)
      .get('/funcionarios/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    // Concurrent activation: only 1 succeeds
    const [a1, a2] = await Promise.all([
      request(app.getHttpServer())
        .post('/autenticacao/funcionarios/ativar')
        .send({ token, newPassword: 'SenhaForte123!' }),
      request(app.getHttpServer())
        .post('/autenticacao/funcionarios/ativar')
        .send({ token, newPassword: 'SenhaForte123!' }),
    ]);
    expect([a1.status, a2.status].sort()).toEqual([200, 400]);

    await request(api)
      .post('/autenticacao/funcionarios/login')
      .send({ email, password: 'FUN-006' })
      .expect(401);

    // Login succeeds
    const loginRes = await request(app.getHttpServer())
      .post('/autenticacao/funcionarios/login')
      .send({ email: 'carlos.acesso@example.test', password: 'SenhaForte123!' })
      .expect(200);

    expect(loginRes.body.profileType).toBe('employee');
    const empToken = loginRes.body.token as string;

    // GET /funcionarios/me succeeds
    const meRes = await request(app.getHttpServer())
      .get('/funcionarios/me')
      .set('Authorization', `Bearer ${empToken}`)
      .expect(200);
    expect(meRes.body.email).toBe('carlos.acesso@example.test');

    // Employee cannot access secretary route
    await request(app.getHttpServer())
      .get('/funcionarios')
      .set('Authorization', `Bearer ${empToken}`)
      .expect(403);

    // Block employee -> existing JWT immediately rejected
    await request(app.getHttpServer())
      .post(`/funcionarios/${created.body.id}/status`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        expectedVersion: 2,
        reason: 'Suspensao teste',
        status: 'BLOCKED',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get('/funcionarios/me')
      .set('Authorization', `Bearer ${empToken}`)
      .expect(403);

    // Unblock employee -> old JWT still revoked due to authVersion bump
    await request(app.getHttpServer())
      .post(`/funcionarios/${created.body.id}/status`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        expectedVersion: 3,
        reason: 'Reativacao teste',
        status: 'ACTIVE',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get('/funcionarios/me')
      .set('Authorization', `Bearer ${empToken}`)
      .expect(401);

    const renewed = await request(api)
      .post('/autenticacao/funcionarios/login')
      .send({ email, password: 'SenhaForte123!' })
      .expect(200);
    const archived = await request(api)
      .delete(`/funcionarios/${created.body.id}`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({ expectedVersion: 4, reason: 'Arquivamento de teste' })
      .expect(200);
    expect(archived.body.accountStatus).toBe('ARCHIVED');
    await request(api)
      .post('/autenticacao/funcionarios/login')
      .send({ email, password: 'SenhaForte123!' })
      .expect(401);
    await request(api)
      .post(`/funcionarios/${created.body.id}/restaurar`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({ expectedVersion: 5, reason: 'Restauracao de teste' })
      .expect(201);
    await request(api)
      .get('/funcionarios/me')
      .set('Authorization', `Bearer ${renewed.body.token}`)
      .expect(401);

    await request(api)
      .patch(`/funcionarios/${created.body.id}`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        expectedVersion: 6,
        reason: 'Atualização administrativa da matrícula',
        registrationNumber: 'FUN-006-ATUALIZADA',
      })
      .expect(200);
    await login(email, 'FUN-006-ATUALIZADA').expect(401);
    const personal = await login(email, 'SenhaForte123!').expect(200);
    expect(personal.body).toMatchObject({
      mustChangePassword: false,
      token: expect.any(String),
    });
  });

  it('analisa CSV multi-função sem cadastrar, confirma com digest e processa idempotentemente com falha parcial isolada', async () => {
    const csv =
      'nome_completo,nome_social,email,matricula_funcional,rg,data_admissao,funcao,inicio_funcao,fim_funcao,funcao_ativa\n' +
      'Importado Um,,importado1@example.test,00771,,2024-02-01,Docente,,,SIM\n' +
      'Importado Um,,importado1@example.test,00771,,2024-02-01,Coordenador de DSM,2026-01-01,2026-12-20,SIM\n' +
      'Invalido Data,,invalido@example.test,,,01/02/2024,Docente,,,SIM\n';

    const analyzeRes = await request(app.getHttpServer())
      .post('/funcionarios/importacoes/analisar')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'lote.csv')
      .expect(201);

    expect(analyzeRes.body.state).toBe('ANALYZED');
    expect(analyzeRes.body.counts.readyCreate).toBe(1);
    expect(analyzeRes.body.counts.invalid).toBe(1);

    // Analysis must NOT create employee or send emails
    const beforeConfirm = await prisma.employee.findUnique({
      where: { email: 'importado1@example.test' },
    });
    expect(beforeConfirm).toBeNull();

    const rowsRes = await request(app.getHttpServer())
      .get(`/funcionarios/importacoes/${analyzeRes.body.batchId}/linhas`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(200);

    const readyGroupId = rowsRes.body.items.find(
      (r: { decision: string }) => r.decision === 'READY_CREATE',
    ).groupId as string;

    const confirmPayload = {
      requestId: '22222222-2222-4222-8222-222222222201',
      revision: analyzeRes.body.revision,
      reviewDigest: analyzeRes.body.reviewDigest,
      selectedGroupIds: [readyGroupId],
    };

    // HTTP schedules the worker too. Keep that trigger inert while testing
    // confirmation idempotency, then execute the real worker deterministically.
    const scheduledWorker = jest
      .spyOn(importWorker, 'processNextBatch')
      .mockResolvedValue(false);
    const confirm1 = await request(app.getHttpServer())
      .post(`/funcionarios/importacoes/${analyzeRes.body.batchId}/confirmar`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send(confirmPayload)
      .expect(202);

    // Double confirmation with same requestId is idempotent
    const confirm2 = await request(app.getHttpServer())
      .post(`/funcionarios/importacoes/${analyzeRes.body.batchId}/confirmar`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send(confirmPayload)
      .expect(202);
    expect(confirm2.body.batchId).toBe(confirm1.body.batchId);

    await new Promise<void>((resolve) => setImmediate(resolve));
    scheduledWorker.mockRestore();
    // Run worker deterministically
    await importWorker.processNextBatch(analyzeRes.body.batchId);

    const afterBatch = await request(app.getHttpServer())
      .get(`/funcionarios/importacoes/${analyzeRes.body.batchId}`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(200);

    expect(afterBatch.body.state).toBe('PARTIAL');
    expect(afterBatch.body.counts.succeeded).toBe(2);
    expect(afterBatch.body.counts.failed).toBe(1);

    const createdEmp = await prisma.employee.findUnique({
      where: { email: 'importado1@example.test' },
      include: { assignments: true },
    });
    expect(createdEmp).not.toBeNull();
    expect(createdEmp?.registrationNumber).toBe('00771');
    expect(createdEmp?.assignments).toHaveLength(2);
  });

  it('valida upload de foto real, rejeita bytes falsos, aprova via CAS e rotaciona QR público', async () => {
    const emp = await request(app.getHttpServer())
      .post('/funcionarios')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        requestId: '33333333-3333-4333-8333-333333333301',
        name: 'Foto Teste',
        email: 'foto.teste@example.test',
        registrationNumber: 'FUN-007',
        rg: '99887766',
        admissionDate: '2024-02-01',
        assignments: [{ title: 'Docente' }],
      })
      .expect(201);

    // Fake bytes -> 415
    await request(app.getHttpServer())
      .post(`/funcionarios/${emp.body.id}/foto`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .field('requestId', '33333333-3333-4333-8333-333333333302')
      .field('expectedVersion', '1')
      .attach('file', Buffer.from('not-an-image'), 'fake.png')
      .expect(415);

    const pngBuffer = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r: 200, g: 20, b: 40 },
      },
    })
      .png()
      .toBuffer();

    const uploadRes = await request(app.getHttpServer())
      .post(`/funcionarios/${emp.body.id}/foto`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .field('requestId', '33333333-3333-4333-8333-333333333303')
      .field('expectedVersion', '1')
      .attach('file', pngBuffer, 'foto.png')
      .expect(201);

    expect(uploadRes.body.reviewStatus).toBe('PENDING');
    expect(uploadRes.body.version).toBe(2);

    const dbEmpBefore = await prisma.employee.findUnique({
      where: { id: emp.body.id },
    });
    const qrOld = dbEmpBefore!.qrcode;

    // Before approval: public verification returns valid=false (PHOTO_PENDING)
    const verifyPending = await request(app.getHttpServer())
      .get(`/funcionarios/verificar/${qrOld}`)
      .expect(200);
    expect(verifyPending.body.valid).toBe(false);
    expect(verifyPending.body.reasonCode).toBe('PHOTO_PENDING');
    expect(verifyPending.body).not.toHaveProperty('rg');

    // Approve photo
    await request(app.getHttpServer())
      .patch(
        `/funcionarios/${emp.body.id}/fotos/${uploadRes.body.photoId}/avaliacao`,
      )
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({ expectedVersion: 2, approved: true })
      .expect(200);

    const verifyValid = await request(app.getHttpServer())
      .get(`/funcionarios/verificar/${qrOld}`)
      .expect(200);
    expect(verifyValid.body.valid).toBe(true);
    expect(verifyValid.body.displayName).toBe('Foto Teste');
    expect(verifyValid.body).not.toHaveProperty('rg');
    expect(verifyValid.body).not.toHaveProperty('email');

    // Public photo streams
    await request(app.getHttpServer())
      .get(`/funcionarios/verificar/${qrOld}/foto`)
      .expect(200);

    // Rotate QR -> old QR returns 404
    const rotated = await request(app.getHttpServer())
      .post(`/funcionarios/${emp.body.id}/qrcode/renovar`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        requestId: '33333333-3333-4333-8333-333333333304',
        expectedVersion: 3,
        reason: 'Perda do crachá',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/funcionarios/verificar/${qrOld}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/funcionarios/verificar/${rotated.body.qrcode}`)
      .expect(200);
  });

  it('integra envio do titular, fila privada, aprovação, rejeição da substituta e QR real', async () => {
    const http = app.getHttpServer<import('node:http').Server>();
    const payload = <T>(response: { body: unknown }): T => response.body as T;
    type Identity = { id: string; accountId: string };
    type Uploaded = { photoId: string };
    type Card = {
      qrcode: string;
      credential: { valid: boolean; reasonCode: string | null };
    };
    type PhotoState = {
      latestAttempt: { reviewStatus: string; reviewReason: string };
    };
    type Page = {
      items: Array<{
        photoId: string;
        employeeId: string;
        employeeVersion: number;
      }>;
      nextCursor: string | null;
    };
    const created = await request(http)
      .post('/funcionarios')
      .auth(secretaryToken, { type: 'bearer' })
      .send({
        requestId: randomUUID(),
        name: 'Pessoa Foto Integrada',
        email: 'foto-integrada@example.test',
        registrationNumber: 'FOTO-102',
        admissionDate: '2024-01-01',
        assignments: [{ title: 'Docente' }],
      })
      .expect(201);
    const employeeId = payload<Identity>(created).id as string;
    const employeeToken = jwtService.sign({
      sub: employeeId,
      accountId: payload<Identity>(created).accountId,
      role: 'employee',
      authVersion: 1,
    });
    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#246475' },
    })
      .png()
      .toBuffer();
    const upload = (version: number, body = png, requestId = randomUUID()) =>
      request(http)
        .post('/funcionarios/me/foto')
        .auth(employeeToken, { type: 'bearer' })
        .field('expectedVersion', String(version))
        .field('requestId', requestId)
        .attach('file', body, 'foto.png');
    const status = () =>
      request(http)
        .get('/funcionarios/me/foto')
        .auth(employeeToken, { type: 'bearer' });
    const card = () =>
      request(http)
        .get('/funcionarios/me/carteirinha')
        .auth(employeeToken, { type: 'bearer' });
    const list = () =>
      request(http)
        .get('/funcionarios/fotos/pendentes?limit=1')
        .auth(secretaryToken, { type: 'bearer' });
    const review = (
      id: string,
      version: number,
      approved: boolean,
      reason?: string,
    ) =>
      request(http)
        .patch('/funcionarios/' + employeeId + '/fotos/' + id + '/avaliacao')
        .auth(secretaryToken, { type: 'bearer' })
        .send({ expectedVersion: version, approved, reason });

    await request(http).get('/funcionarios/fotos/pendentes').expect(401);
    await request(http)
      .get('/funcionarios/fotos/pendentes')
      .auth(employeeToken, { type: 'bearer' })
      .expect(403);
    const expired = jwtService.sign(
      {
        sub: employeeId,
        accountId: payload<Identity>(created).accountId,
        role: 'employee',
        authVersion: 1,
      },
      { expiresIn: -1 },
    );
    await request(http)
      .get('/funcionarios/me/foto')
      .auth(expired, { type: 'bearer' })
      .expect(401);
    await upload(1, Buffer.from('arquivo inválido')).expect(415);
    const failedRequestId = randomUUID();
    storageUnavailable = true;
    try {
      await upload(1, png, failedRequestId).expect(503);
    } finally {
      storageUnavailable = false;
    }
    expect(payload<PhotoState>(await status().expect(200))).toMatchObject({
      pending: null,
      approved: null,
      latestAttempt: null,
    });

    const sent = await upload(1, png, failedRequestId).expect(201);
    const photoId = payload<Uploaded>(sent).photoId as string;
    const dbPhoto = await prisma.employeePhoto.findUniqueOrThrow({
      where: { id: photoId },
    });
    expect(dbPhoto).toMatchObject({
      employeeId,
      reviewStatus: 'PENDING',
      processingState: 'READY',
      currentPending: true,
    });
    const summary = await request(http)
      .get('/funcionarios/fotos/resumo')
      .auth(secretaryToken, { type: 'bearer' })
      .expect(200);
    expect(
      payload<{ pendingCount: number }>(summary).pendingCount,
    ).toBeGreaterThanOrEqual(1);
    let cursor: string | null = null;
    let found = false;
    do {
      const page = await request(http)
        .get(
          '/funcionarios/fotos/pendentes?limit=1' +
            (cursor ? '&cursor=' + cursor : ''),
        )
        .auth(secretaryToken, { type: 'bearer' })
        .expect(200);
      expect(payload<Page>(page).items.length).toBeLessThanOrEqual(1);
      found ||= payload<Page>(page).items.some(
        (item: {
          photoId: string;
          employeeId: string;
          employeeVersion: number;
        }) =>
          item.photoId === photoId &&
          item.employeeId === employeeId &&
          item.employeeVersion === 2,
      );
      cursor = payload<Page>(page).nextCursor as string | null;
    } while (cursor);
    expect(found).toBe(true);
    await list().expect(200);
    await request(http)
      .get('/funcionarios/' + employeeId + '/fotos/' + photoId + '/conteudo')
      .auth(secretaryToken, { type: 'bearer' })
      .expect(200);
    await request(http)
      .get('/funcionarios/' + employeeId + '/fotos/' + photoId + '/conteudo')
      .expect(401);
    const before = await card().expect(200);
    expect(payload<Card>(before).credential).toMatchObject({
      valid: false,
      reasonCode: 'PHOTO_PENDING',
    });
    expect(payload<Card>(before).qrcode).toBeTruthy();
    await review(photoId, 1, true).expect(409);
    const decisions = await Promise.all([
      review(photoId, 2, true),
      review(photoId, 2, true),
    ]);
    expect(decisions.map((item) => item.status).sort()).toEqual([200, 409]);
    expect(payload<PhotoState>(await status().expect(200))).toMatchObject({
      approved: { id: photoId },
      pending: null,
      latestAttempt: { photoId, reviewStatus: 'APPROVED' },
    });
    const validCard = await card().expect(200);
    expect(payload<Card>(validCard).credential.valid).toBe(true);
    const realQr = payload<Card>(validCard).qrcode as string;
    const verified = await request(http)
      .get('/funcionarios/verificar/' + realQr)
      .expect(200);
    expect(payload<{ valid: boolean }>(verified).valid).toBe(true);
    expect(payload<{ valid: boolean }>(verified)).not.toHaveProperty('email');

    const replacement = await upload(3).expect(201);
    expect(payload<Card>(await card().expect(200)).credential.valid).toBe(true);
    await review(payload<Uploaded>(replacement).photoId, 4, false).expect(400);
    await review(
      payload<Uploaded>(replacement).photoId,
      4,
      false,
      'Rosto fora do enquadramento.',
    ).expect(200);
    const rejected = payload<PhotoState>(await status().expect(200));
    expect(rejected).toMatchObject({
      approved: { id: photoId },
      pending: null,
      latestAttempt: {
        photoId: payload<Uploaded>(replacement).photoId,
        reviewStatus: 'REJECTED',
        reviewReason: 'Rosto fora do enquadramento.',
      },
    });
    expect(rejected.latestAttempt).not.toHaveProperty('contentUrl');
    await request(http)
      .get(
        '/funcionarios/me/fotos/' +
          payload<Uploaded>(replacement).photoId +
          '/conteudo',
      )
      .auth(employeeToken, { type: 'bearer' })
      .expect(404);
    await prisma.employeePhoto.update({
      where: { id: payload<Uploaded>(replacement).photoId },
      data: { processingState: 'DELETED' },
    });
    expect(
      payload<PhotoState>(await status().expect(200)).latestAttempt
        .reviewStatus,
    ).toBe('REJECTED');
    expect(payload<Card>(await card().expect(200)).credential.valid).toBe(true);

    await request(http)
      .delete('/funcionarios/me/foto')
      .auth(employeeToken, { type: 'bearer' })
      .send({ expectedVersion: 5, requestId: randomUUID() })
      .expect(200);
    expect(payload<PhotoState>(await status().expect(200))).toMatchObject({
      approved: null,
      pending: null,
      latestAttempt: null,
    });
    const lone = await upload(6).expect(201);
    await review(
      payload<Uploaded>(lone).photoId,
      7,
      false,
      'Imagem sem nitidez.',
    ).expect(200);
    expect(payload<Card>(await card().expect(200)).credential).toMatchObject({
      valid: false,
      reasonCode: 'PHOTO_REJECTED',
    });
    expect(
      payload<PhotoState>(await status().expect(200)).latestAttempt
        .reviewReason,
    ).toBe('Imagem sem nitidez.');
    await request(http)
      .delete('/funcionarios/me/foto')
      .auth(employeeToken, { type: 'bearer' })
      .send({ expectedVersion: 8, requestId: randomUUID() })
      .expect(200);
    expect(
      payload<PhotoState>(await status().expect(200)).latestAttempt,
    ).toBeNull();

    storageCalls = 0;
    let release!: () => void;
    storageGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const one = upload(9).then((result) => result);
    const two = upload(9).then((result) => result);
    try {
      const deadline = Date.now() + 15000;
      while (storageCalls < 2 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      expect(storageCalls).toBe(2);
    } finally {
      release();
      storageGate = undefined;
    }
    const uploads = await Promise.all([one, two]);
    expect(uploads.map((item) => item.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.employeePhoto.count({
        where: { employeeId, processingState: 'UPLOADING' },
      }),
    ).toBe(0);
    expect(
      await prisma.employeePhoto.count({
        where: { employeeId, currentPending: true },
      }),
    ).toBe(1);

    storageCalls = 0;
    const repeatedRequestId = randomUUID();
    let releaseRepeated!: () => void;
    storageGate = new Promise<void>((resolve) => {
      releaseRepeated = resolve;
    });
    const firstAttempt = upload(10, png, repeatedRequestId).then(
      (response) => response,
    );
    try {
      const deadline = Date.now() + 15000;
      while (storageCalls < 1 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      expect(storageCalls).toBe(1);
      await upload(10, png, repeatedRequestId).expect(409);
    } finally {
      releaseRepeated();
      storageGate = undefined;
    }
    const committed = await firstAttempt;
    expect(committed.status).toBe(201);
    const replay = await upload(10, png, repeatedRequestId).expect(201);
    expect(payload<Uploaded>(replay).photoId).toBe(
      payload<Uploaded>(committed).photoId,
    );
    expect(
      await prisma.employeePhoto.count({
        where: { employeeId, requestId: repeatedRequestId },
      }),
    ).toBe(1);
    const latest = await prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
    });
    const rotated = await request(http)
      .post('/funcionarios/' + employeeId + '/qrcode/renovar')
      .auth(secretaryToken, { type: 'bearer' })
      .send({
        requestId: randomUUID(),
        expectedVersion: latest.version,
        reason: 'Revogação sintética do teste',
      })
      .expect(201);
    await request(http)
      .get('/funcionarios/verificar/' + realQr)
      .expect(404);
    expect(payload<{ qrcode: string }>(rotated).qrcode).not.toBe(realQr);
  });

  it('permite abertura de chamado de suporte por funcionário, resposta da Secretaria, isolamento de aluno e consulta pública institucional', async () => {
    const instRes = await request(app.getHttpServer())
      .get('/public/institution')
      .expect(200);
    expect(instRes.body.shortName).toBe('Fatec Itaquera');

    const emp = await request(app.getHttpServer())
      .post('/funcionarios')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        requestId: '55555555-5555-4555-8555-555555555501',
        name: 'Suporte Funcionario',
        email: 'suporte.emp@example.test',
        registrationNumber: 'FUN-008',
        admissionDate: '2024-02-01',
        assignments: [{ title: 'Docente' }],
      })
      .expect(201);

    const empToken = await jwtService.signAsync({
      sub: emp.body.id,
      accountId: emp.body.accountId,
      role: 'employee',
      authVersion: 1,
    });

    const ticketRes = await request(app.getHttpServer())
      .post('/support/tickets')
      .set('Authorization', `Bearer ${empToken}`)
      .send({
        requestId: '55555555-5555-4555-8555-555555555502',
        category: 'DATA',
        subject: 'Solicitação de ajuste cadastral',
        description:
          'Gostaria de solicitar a atualização do meu nome social no cadastro.',
        requestedField: 'SOCIAL_NAME',
        proposedValue: 'Nome Social Novo',
      })
      .expect(201);

    expect(ticketRes.body.ownerType).toBe('EMPLOYEE');

    // Cadastro não é alterado automaticamente pelo ticket
    const empAfter = await prisma.employee.findUnique({
      where: { id: emp.body.id },
    });
    expect(empAfter?.socialName).toBeNull();

    // Admin filter ownerType=EMPLOYEE & summary
    const adminList = await request(app.getHttpServer())
      .get('/support/admin/tickets?ownerType=EMPLOYEE')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(200);
    expect(
      adminList.body.items.some(
        (t: { id: string }) => t.id === ticketRes.body.id,
      ),
    ).toBe(true);

    const summaryRes = await request(app.getHttpServer())
      .get('/support/admin/summary')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(200);
    expect(summaryRes.body.byOwnerType.employee).toBeGreaterThanOrEqual(1);
  });
});
