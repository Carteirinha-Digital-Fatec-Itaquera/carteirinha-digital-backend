/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ProjectCreditsController } from './project-credits.controller';
import { ProjectCreditsAdminController } from './project-credits-admin.controller';
import { ProjectCreditsService } from './project-credits.service';
import { ProjectCreditsAssetService } from './services/project-credits-asset.service';
import { ProjectCreditsImporter } from './importer/project-credits.importer';
import { SecretaryActiveGuard } from './guards/secretary-active.guard';
import { PrismaService } from '../database/prisma.service';
import {
  normalizeAndValidateUrl,
  validateSemester,
} from './utils/url-validator';

describe('Project Credits Module & Administration', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let studentToken: string;
  let activeSecretaryToken: string;
  let expiredSecretaryToken: string;

  const activeSecretary = {
    id: 1,
    name: 'Secretaria Ativa',
    email: 'sec.ativa@cps.sp.gov.br',
    dueDate: new Date(Date.now() + 86400000), // amanhã
    birthDate: new Date('1990-01-01'),
  };

  const expiredSecretary = {
    id: 2,
    name: 'Secretaria Vencida',
    email: 'sec.vencida@cps.sp.gov.br',
    dueDate: new Date(Date.now() - 86400000), // ontem
    birthDate: new Date('1990-01-01'),
  };

  const mockPrisma = {
    secretary: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: number } }) => {
          if (where.id === 1) return Promise.resolve(activeSecretary);
          if (where.id === 2) return Promise.resolve(expiredSecretary);
          return Promise.resolve(null);
        }),
    },
    projectContributor: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    projectContributionParticipation: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    projectContributorLink: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    projectCreditAudit: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    projectCreditAssetCleanup: {
      create: jest.fn(),
    },
    $transaction: jest
      .fn()
      .mockImplementation((callback) => Promise.resolve(callback(mockPrisma))),
  };

  const mockAssetService = {
    processPhoto: jest.fn().mockResolvedValue({
      buffer: Buffer.from('mock-webp'),
      mimeType: 'image/webp',
    }),
    uploadDraftPhoto: jest.fn().mockResolvedValue({
      storageKey: 'project-credits/private/draft_123',
    }),
    publishPhoto: jest.fn().mockResolvedValue({
      publicUrl: 'https://cdn.example.com/photo.webp',
      storageKey: 'project-credits/public/pub_123',
    }),
    getPrivateDownloadUrl: jest
      .fn()
      .mockReturnValue('https://cdn.example.com/private/signed-url'),
    destroyAsset: jest.fn().mockResolvedValue(undefined),
    queueAssetCleanup: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'credits-jwt-test-secret-key-12345',
        }),
      ],
      controllers: [ProjectCreditsController, ProjectCreditsAdminController],
      providers: [
        AuthGuard,
        RolesGuard,
        SecretaryActiveGuard,
        ProjectCreditsService,
        ProjectCreditsImporter,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ProjectCreditsAssetService, useValue: mockAssetService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    jwt = moduleRef.get(JwtService);
    studentToken = jwt.sign({
      sub: '1234567',
      role: 'student',
      accountId: 'student-acc-uuid-123',
    });
    activeSecretaryToken = jwt.sign({ sub: 1, role: 'secretary' });
    expiredSecretaryToken = jwt.sign({ sub: 2, role: 'secretary' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.projectContributor.findUnique.mockReset();
    mockPrisma.projectContributor.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('URL and Semester Validator', () => {
    it('accepts valid semester formats YYYY.1 and YYYY.2', () => {
      expect(validateSemester('2026.1')).toBe('2026.1');
      expect(validateSemester('2026.2')).toBe('2026.2');
    });

    it('rejects invalid semester format', () => {
      expect(() => validateSemester('2026.3')).toThrow(BadRequestException);
      expect(() => validateSemester('2026-1')).toThrow(BadRequestException);
      expect(() => validateSemester('invalido')).toThrow(BadRequestException);
    });

    it('validates HTTPS links with query params and anchors', () => {
      const result = normalizeAndValidateUrl(
        'github',
        'https://github.com/profile?tab=repositories#header',
        'Meu GitHub',
      );
      expect(result.url).toBe(
        'https://github.com/profile?tab=repositories#header',
      );
      expect(result.label).toBe('Meu GitHub');
    });

    it('rejects HTTP, javascript:, data: and credentials', () => {
      expect(() =>
        normalizeAndValidateUrl('external', 'http://insecure.com', 'Insecure'),
      ).toThrow(BadRequestException);
      expect(() =>
        normalizeAndValidateUrl('external', 'javascript:alert(1)', 'XSS'),
      ).toThrow(BadRequestException);
      expect(() =>
        normalizeAndValidateUrl(
          'external',
          'https://user:pass@example.com',
          'Creds',
        ),
      ).toThrow(BadRequestException);
    });

    it('validates mailto for email links', () => {
      const res = normalizeAndValidateUrl(
        'email',
        'contato@fatec.sp.gov.br',
        'Contato',
      );
      expect(res.url).toBe('mailto:contato@fatec.sp.gov.br');
      expect(res.kind).toBe('email');
    });
  });

  describe('Public API (GET /project-credits)', () => {
    it('is publicly accessible and returns published contributors with Cache-Control no-store', async () => {
      mockPrisma.projectContributor.findMany.mockResolvedValue([
        {
          id: 'wellingtonspdev',
          name: 'Wellington S. P.',
          photoUrl: null,
          status: 'PUBLISHED',
          publishedSnapshot: {
            id: 'wellingtonspdev',
            name: 'Wellington S. P.',
            photoUrl: null,
            participations: [
              {
                semester: '2026.2',
                course: null,
                roles: ['Idealizador & Desenvolvedor Full Stack'],
                contribution: 'Concepção do projeto',
              },
            ],
            contacts: [
              {
                kind: 'github',
                label: 'GitHub',
                href: 'https://github.com/wellingtonspdev',
              },
            ],
          },
        },
      ]);

      const res = await request(app.getHttpServer())
        .get('/project-credits')
        .expect(200);

      expect(res.header['cache-control']).toBe('no-store');
      expect(res.body.contributors).toHaveLength(1);
      expect(res.body.contributors[0].id).toBe('wellingtonspdev');
      expect(res.body.contributors[0].name).toBe('Wellington S. P.');
    });
  });

  describe('Security and Access Control on Admin Endpoints', () => {
    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer())
        .get('/project-credits/admin/contributors')
        .expect(401);
    });

    it('returns 403 when called with student token', async () => {
      await request(app.getHttpServer())
        .get('/project-credits/admin/contributors')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);
    });

    it('returns 403 PASSWORD_RENEWAL_REQUIRED when secretary dueDate is expired', async () => {
      const res = await request(app.getHttpServer())
        .get('/project-credits/admin/contributors')
        .set('Authorization', `Bearer ${expiredSecretaryToken}`)
        .expect(403);

      expect(res.body.code).toBe('PASSWORD_RENEWAL_REQUIRED');
    });

    it('returns 200 when secretary is active and password renewal is up-to-date', async () => {
      mockPrisma.projectContributor.count.mockResolvedValue(0);
      mockPrisma.projectContributor.findMany.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/project-credits/admin/contributors')
        .set('Authorization', `Bearer ${activeSecretaryToken}`)
        .expect(200);
    });
  });

  describe('Concurrency & Lifecycle Controls', () => {
    it('returns 409 Conflict when update expectedVersion does not match current version', async () => {
      mockPrisma.projectContributor.findUnique.mockResolvedValue({
        id: 'c-1',
        draftVersion: 3,
        participations: [],
        links: [],
      });

      const res = await request(app.getHttpServer())
        .put('/project-credits/admin/contributors/c-1')
        .set('Authorization', `Bearer ${activeSecretaryToken}`)
        .send({
          expectedVersion: 2, // mismatch
          name: 'Nome Atualizado',
        })
        .expect(409);

      expect(res.body.message).toContain('Conflito de versão');
    });

    it('returns 409 Conflict when publish expectedVersion does not match current version', async () => {
      mockPrisma.projectContributor.findUnique.mockResolvedValue({
        id: 'c-1',
        draftVersion: 5,
        participations: [],
        links: [],
      });

      await request(app.getHttpServer())
        .post('/project-credits/admin/contributors/c-1/publish')
        .set('Authorization', `Bearer ${activeSecretaryToken}`)
        .send({
          expectedVersion: 4,
          profileConfirmed: true,
        })
        .expect(409);
    });

    it('blocks publication if profileConfirmed is false', async () => {
      mockPrisma.projectContributor.findUnique.mockResolvedValue({
        id: 'c-1',
        name: 'Carlos',
        draftVersion: 1,
        participations: [
          { semester: '2026.1', roles: ['Dev'], confirmed: true },
        ],
        links: [],
      });

      await request(app.getHttpServer())
        .post('/project-credits/admin/contributors/c-1/publish')
        .set('Authorization', `Bearer ${activeSecretaryToken}`)
        .send({
          expectedVersion: 1,
          profileConfirmed: false,
        })
        .expect(400);
    });

    it('blocks publication if there are no participations', async () => {
      mockPrisma.projectContributor.findUnique.mockResolvedValue({
        id: 'c-1',
        name: 'Carlos',
        draftVersion: 1,
        participations: [],
        links: [],
      });

      await request(app.getHttpServer())
        .post('/project-credits/admin/contributors/c-1/publish')
        .set('Authorization', `Bearer ${activeSecretaryToken}`)
        .send({
          expectedVersion: 1,
          profileConfirmed: true,
        })
        .expect(400);
    });

    it('successfully publishes valid draft, generating snapshot and audit trail', async () => {
      const existing = {
        id: 'c-1',
        slug: 'carlos-silva',
        name: 'Carlos Silva',
        status: 'DRAFT',
        draftVersion: 1,
        photoUrl: null,
        photoPendingKey: null,
        photoStorageKey: null,
        participations: [
          {
            id: 'p-1',
            contributorId: 'c-1',
            semester: '2026.1',
            course: 'DSM',
            roles: ['Desenvolvedor Frontend'],
            contribution: 'Interface de usuário',
            confirmed: true,
            order: 0,
          },
        ],
        links: [
          {
            id: 'l-1',
            contributorId: 'c-1',
            kind: 'GITHUB',
            label: 'GitHub',
            url: 'https://github.com/carlossilva',
            confirmed: true,
            order: 0,
          },
        ],
      };

      mockPrisma.projectContributor.findUnique
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({
          ...existing,
          status: 'PUBLISHED',
          draftVersion: 2,
          publishedVersion: 2,
          publishedSnapshot: { id: 'c-1', name: 'Carlos Silva' },
          updatedAt: new Date(),
          createdAt: new Date(),
        });

      mockPrisma.projectContributor.update.mockResolvedValue({ id: 'c-1' });
      mockPrisma.projectCreditAudit.create.mockResolvedValue({ id: 'a-1' });

      const res = await request(app.getHttpServer())
        .post('/project-credits/admin/contributors/c-1/publish')
        .set('Authorization', `Bearer ${activeSecretaryToken}`)
        .send({
          expectedVersion: 1,
          profileConfirmed: true,
        })
        .expect(201);

      expect(res.body.status).toBe('PUBLISHED');
      expect(mockPrisma.projectContributor.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c-1', draftVersion: 1 } }),
      );
      expect(mockPrisma.projectCreditAudit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'PUBLISHED',
            performedBySecretaryId: 1,
          }),
        }),
      );
    });

    it('archives contributor and removes from public listing', async () => {
      mockPrisma.projectContributor.findUnique
        .mockResolvedValueOnce({
          id: 'c-1',
          draftVersion: 2,
        })
        .mockResolvedValueOnce({
          id: 'c-1',
          slug: 'carlos-silva',
          name: 'Carlos Silva',
          status: 'ARCHIVED',
          draftVersion: 3,
          participations: [],
          links: [],
          updatedAt: new Date(),
          createdAt: new Date(),
        });

      const res = await request(app.getHttpServer())
        .post('/project-credits/admin/contributors/c-1/archive')
        .set('Authorization', `Bearer ${activeSecretaryToken}`)
        .send({
          expectedVersion: 2,
          reason: 'Solicitação do colaborador',
        })
        .expect(201);

      expect(res.body.status).toBe('ARCHIVED');
      expect(mockPrisma.projectCreditAudit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'ARCHIVED',
            performedBySecretaryId: 1,
          }),
        }),
      );
    });

    it('restores archived contributor back to DRAFT without auto-publishing', async () => {
      mockPrisma.projectContributor.findUnique
        .mockResolvedValueOnce({
          id: 'c-1',
          draftVersion: 3,
        })
        .mockResolvedValueOnce({
          id: 'c-1',
          slug: 'carlos-silva',
          name: 'Carlos Silva',
          status: 'DRAFT',
          draftVersion: 4,
          participations: [],
          links: [],
          updatedAt: new Date(),
          createdAt: new Date(),
        });

      const res = await request(app.getHttpServer())
        .post('/project-credits/admin/contributors/c-1/restore')
        .set('Authorization', `Bearer ${activeSecretaryToken}`)
        .send({
          expectedVersion: 3,
        })
        .expect(201);

      expect(res.body.status).toBe('DRAFT');
      expect(mockPrisma.projectCreditAudit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'RESTORED',
            performedBySecretaryId: 1,
          }),
        }),
      );
    });
  });

  describe('Idempotent Importer', () => {
    it('creates curator credits on dry-run false when DB is empty', async () => {
      const importer = app.get(ProjectCreditsImporter);
      mockPrisma.projectContributor.findUnique.mockResolvedValue(null);

      const result = await importer.importCuratedCredits(false);

      expect(result.created).toBe(1);
      expect(result.unchanged).toBe(0);
      expect(mockPrisma.projectContributor.create).toHaveBeenCalled();
      expect(mockPrisma.projectCreditAudit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'PUBLISHED',
            performedByName: 'SISTEMA_IMPORTADOR_INICIAL',
          }),
        }),
      );
    });

    it('reports UNCHANGED and does not modify database when records already exist identically', async () => {
      const importer = app.get(ProjectCreditsImporter);
      mockPrisma.projectContributor.findUnique.mockResolvedValue({
        id: 'wellingtonspdev',
        name: 'Wellington Siqueira Porto',
        participations: [
          {
            semester: '2026.2',
            roles: ['Desenvolvimento do projeto'],
          },
        ],
        links: [{ kind: 'GITHUB', url: 'https://github.com/wellingtonspdev' }],
      });

      const result = await importer.importCuratedCredits(false);

      expect(result.created).toBe(0);
      expect(result.unchanged).toBe(1);
      expect(mockPrisma.projectContributor.create).not.toHaveBeenCalled();
    });
  });
});
