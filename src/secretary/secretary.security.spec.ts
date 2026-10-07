/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { SecretaryController } from './secretary.controller';
import { SecretaryService } from './secretary.service';
import { SecretaryMapper } from './mapper/secretary.mapper';
import { StudentService } from '../student/student.service';

describe('Secretary Security & Hardening', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let studentToken: string;
  let secretary1Token: string;
  let secretary2Token: string;

  const mockSecretaryService = {
    getSecretary: jest.fn().mockResolvedValue([]),
    getSecretaryById: jest.fn().mockImplementation((id: number) => {
      if (id === 1) {
        return Promise.resolve({
          id: 1,
          name: 'Secretaria 1',
          email: 'sec1@cps.sp.gov.br',
          dueDate: new Date(),
          birthDate: new Date(),
        });
      }
      return Promise.resolve(null);
    }),
    getSecretaryByEmail: jest.fn().mockResolvedValue({
      id: 1,
      name: 'Secretaria 1',
      email: 'sec1@cps.sp.gov.br',
    }),
    createSecretary: jest.fn().mockResolvedValue({ message: 'Código enviado' }),
    confirmSecretary: jest.fn().mockImplementation((email, code, dto) => {
      if (!email.endsWith('@cps.sp.gov.br')) {
        throw new Error(
          'Apenas e-mails com domínio @cps.sp.gov.br são permitidos.',
        );
      }
      if (dto.email && dto.email !== email) {
        throw new Error('E-mail fornecido diverge do e-mail verificado.');
      }
      return Promise.resolve({ id: 10, email });
    }),
    updateSecretaryFromDto: jest.fn().mockImplementation((id, dto) => {
      if (dto.email && !dto.email.endsWith('@cps.sp.gov.br')) {
        throw new Error(
          'Apenas e-mails com domínio @cps.sp.gov.br são permitidos.',
        );
      }
      return Promise.resolve({ message: 'Secretaria atualizada com sucesso' });
    }),
    deleteSecretary: jest.fn().mockResolvedValue(undefined),
  };

  const mockSecretaryMapper = {
    toListDTO: jest.fn().mockReturnValue([]),
    toDTO: jest.fn().mockImplementation((entity) => entity),
  };

  const mockStudentService = {
    getPendingPhotos: jest.fn().mockResolvedValue([]),
    approvePhoto: jest.fn().mockResolvedValue({ ok: true }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'test-jwt-secret-key-1234567890',
        }),
      ],
      controllers: [SecretaryController],
      providers: [
        AuthGuard,
        RolesGuard,
        { provide: SecretaryService, useValue: mockSecretaryService },
        { provide: SecretaryMapper, useValue: mockSecretaryMapper },
        { provide: StudentService, useValue: mockStudentService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    jwt = moduleRef.get(JwtService);
    studentToken = jwt.sign({
      sub: '000123',
      role: 'student',
      accountId: 'student-account-id',
    });
    secretary1Token = jwt.sign({ sub: 1, role: 'secretary' });
    secretary2Token = jwt.sign({ sub: 2, role: 'secretary' });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('PUT /secretaria/atualizar/:id', () => {
    it('returns 401 without authentication', () => {
      return request(app.getHttpServer())
        .put('/secretaria/atualizar/1')
        .send({ name: 'Novo Nome' })
        .expect(401);
    });

    it('returns 403 when called by student', () => {
      return request(app.getHttpServer())
        .put('/secretaria/atualizar/1')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ name: 'Novo Nome' })
        .expect(403);
    });

    it('returns 403 when secretary attempts to update another secretary account', () => {
      return request(app.getHttpServer())
        .put('/secretaria/atualizar/1')
        .set('Authorization', `Bearer ${secretary2Token}`)
        .send({ name: 'Hacked Name' })
        .expect(403);
    });

    it('returns 200 when secretary updates own account', () => {
      return request(app.getHttpServer())
        .put('/secretaria/atualizar/1')
        .set('Authorization', `Bearer ${secretary1Token}`)
        .send({ name: 'Nome Atualizado' })
        .expect(200);
    });
  });

  describe('DELETE /secretaria/deletar/:id', () => {
    it('returns 401 without authentication', () => {
      return request(app.getHttpServer())
        .delete('/secretaria/deletar/1')
        .expect(401);
    });

    it('returns 403 when called by student', () => {
      return request(app.getHttpServer())
        .delete('/secretaria/deletar/1')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);
    });

    it('returns 403 when secretary attempts to delete another secretary account', () => {
      return request(app.getHttpServer())
        .delete('/secretaria/deletar/2')
        .set('Authorization', `Bearer ${secretary1Token}`)
        .expect(403);
    });

    it('returns 200 when secretary deletes own account', () => {
      return request(app.getHttpServer())
        .delete('/secretaria/deletar/1')
        .set('Authorization', `Bearer ${secretary1Token}`)
        .expect(200);
    });
  });

  describe('Administrative Read & Photo Routes', () => {
    it('returns 401 on /secretaria/listar-todos without token', () => {
      return request(app.getHttpServer())
        .get('/secretaria/listar-todos')
        .expect(401);
    });

    it('returns 403 on /secretaria/listar-todos with student token', () => {
      return request(app.getHttpServer())
        .get('/secretaria/listar-todos')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);
    });

    it('returns 200 on /secretaria/listar-todos with secretary token', () => {
      return request(app.getHttpServer())
        .get('/secretaria/listar-todos')
        .set('Authorization', `Bearer ${secretary1Token}`)
        .expect(200);
    });

    it('returns 401 on /secretaria/fotos-pendentes without token', () => {
      return request(app.getHttpServer())
        .get('/secretaria/fotos-pendentes')
        .expect(401);
    });

    it('returns 200 on /secretaria/fotos-pendentes with secretary token', () => {
      return request(app.getHttpServer())
        .get('/secretaria/fotos-pendentes')
        .set('Authorization', `Bearer ${secretary1Token}`)
        .expect(200);
    });
  });
});
