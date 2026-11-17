import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../database/prisma.service';
import { EmployeeModule } from './employee.module';

describe('Employee CRUD & Assignments Integration (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let secretaryToken: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-employee-only';

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: process.env.JWT_SECRET,
          signOptions: { expiresIn: '1h' },
        }),
        EmployeeModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(new PrismaService())
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
    jwtService = moduleRef.get(JwtService);

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

  it('cadastra funcionário sem matrícula com e-mail pessoal, nome social e cargo Secretaria sem conceder permissão', async () => {
    const reqId = '11111111-1111-4111-8111-111111111101';
    const res = await request(app.getHttpServer())
      .post('/funcionarios')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        requestId: reqId,
        name: 'Maria da Silva',
        socialName: 'Maria Silva Social',
        email: 'maria.pessoal@example.test',
        registrationNumber: null,
        rg: null,
        admissionDate: '2024-02-01',
        assignments: [
          { title: 'Secretaria', startsOn: null, validUntil: null, active: true },
          { title: 'Docente', startsOn: '2026-01-01', validUntil: '2027-12-31', active: true },
        ],
      })
      .expect(201);

    expect(res.body.registrationNumber).toBeNull();
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
        registrationNumber: null,
        rg: null,
        admissionDate: '2024-02-01',
        assignments: [
          { title: 'Secretaria', startsOn: null, validUntil: null, active: true },
          { title: 'Docente', startsOn: '2026-01-01', validUntil: '2027-12-31', active: true },
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
        admissionDate: '2024-02-01',
        assignments: [{ title: 'Docente' }],
      })
      .expect(409);
  });

  it('rejeita campos proibidos no corpo (role, accountId, searchText, passwordHash)', async () => {
    await request(app.getHttpServer())
      .post('/funcionarios')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({
        requestId: '11111111-1111-4111-8111-111111111102',
        name: 'Teste Proibido',
        email: 'proibido@example.test',
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
        admissionDate: '2024-02-01',
        assignments: [{ title: 'Coordenador' }],
      })
      .expect(201);

    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/funcionarios/${emp1.body.id}`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({ expectedVersion: 1, reason: 'Ajuste A', name: 'Pessoa Um Editada A' }),
      request(app.getHttpServer())
        .patch(`/funcionarios/${emp1.body.id}`)
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({ expectedVersion: 1, reason: 'Ajuste B', name: 'Pessoa Um Editada B' }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    // Assignment of emp2 cannot be edited under emp1
    await request(app.getHttpServer())
      .patch(`/funcionarios/${emp1.body.id}/funcoes/${emp2.body.assignments[0].id}`)
      .set('Authorization', `Bearer ${secretaryToken}`)
      .send({ expectedVersion: 2, reason: 'Tentativa cruzada', active: false })
      .expect(404);
  });
});
