import { EventCatalogService } from './event-catalog.service';
import { PrismaService } from '../database/prisma.service';
import { EventStorageService } from './event-storage.service';

describe('EventCatalogService - Templates de Certificados', () => {
  let service: EventCatalogService;
  let prisma: {
    certificateTemplate: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    eventAsset: {
      findFirst: jest.Mock;
    };
    eventAudit: {
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      certificateTemplate: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      eventAsset: {
        findFirst: jest.fn(),
      },
      eventAudit: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([]),
          certificateTemplate: prisma.certificateTemplate,
          eventAudit: prisma.eventAudit,
        };
        return cb(tx);
      }),
    };

    service = new EventCatalogService(
      prisma as unknown as PrismaService,
      {} as EventStorageService,
    );
  });

  it('ensureDefaultTemplates cria modelos da Semana de Tecnologia quando ausentes', async () => {
    prisma.certificateTemplate.findFirst.mockResolvedValue(null);

    await service.ensureDefaultTemplates();

    expect(prisma.certificateTemplate.create).toHaveBeenCalledTimes(2);
    expect(prisma.certificateTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'XIII Semana de Tecnologia — Participante',
        role: 'ATTENDEE',
        status: 'PUBLISHED',
      }),
    });
    expect(prisma.certificateTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'XIII Semana de Tecnologia — Palestrante',
        role: 'SPEAKER',
        status: 'PUBLISHED',
      }),
    });
  });

  it('ensureDefaultTemplates publica modelo se existente porem nao publicado', async () => {
    prisma.certificateTemplate.findFirst.mockResolvedValue({
      id: 'existing-id',
      status: 'DRAFT',
    });

    await service.ensureDefaultTemplates();

    expect(prisma.certificateTemplate.update).toHaveBeenCalledWith({
      where: { id: 'existing-id' },
      data: { status: 'PUBLISHED' },
    });
  });

  it('template() com autoPublish true cria modelo com status PUBLISHED', async () => {
    prisma.certificateTemplate.findFirst.mockResolvedValue(null);
    prisma.certificateTemplate.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'tmpl-1', ...data }),
    );

    const result = await service.template(
      {
        name: 'Palestra Customizada',
        role: 'ATTENDEE',
        heading: 'CERTIFICADO',
        edition: 'VIII Encontro Fatec',
        autoPublish: true,
      },
      123,
    );

    expect(result.status).toBe('PUBLISHED');
    expect(prisma.certificateTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Palestra Customizada',
        status: 'PUBLISHED',
      }),
    });
  });
});
