import { EventCatalogService } from './event-catalog.service';
import { PrismaService } from '../database/prisma.service';
import { EventStorageService } from './event-storage.service';

type TemplateRecord = {
  id?: string;
  name?: string;
  role?: string;
  status?: string;
  config?: Record<string, unknown>;
};

describe('EventCatalogService - Templates de Certificados', () => {
  let service: EventCatalogService;
  let prisma: {
    certificateTemplate: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock<Promise<TemplateRecord>, [{ data: TemplateRecord }]>;
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
        create: jest.fn<Promise<TemplateRecord>, [{ data: TemplateRecord }]>(),
        update: jest.fn(),
      },
      eventAsset: {
        findFirst: jest.fn(),
      },
      eventAudit: {
        create: jest.fn(),
      },
      $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => {
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

    expect(prisma.certificateTemplate.create).toHaveBeenCalledTimes(4);
    const created = prisma.certificateTemplate.create.mock.calls.map(
      ([args]) => args.data,
    );
    expect(
      created.find((row) =>
        row.name?.endsWith('Azul Circuitos — Participante'),
      ),
    ).toMatchObject({
      config: {
        design: 'TECHNOLOGY_BLUE_2026',
        attendeeAction: 'participou da atividade',
      },
    });
    expect(
      created.find(
        (row) => row.name === 'XIII Semana de Tecnologia — Participante',
      ),
    ).toMatchObject({ role: 'ATTENDEE', status: 'PUBLISHED' });
    expect(
      created.find(
        (row) => row.name === 'XIII Semana de Tecnologia — Palestrante',
      ),
    ).toMatchObject({ role: 'SPEAKER', status: 'PUBLISHED' });
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
    expect(
      prisma.certificateTemplate.create.mock.calls[0][0].data,
    ).toMatchObject({
      name: 'Palestra Customizada',
      status: 'PUBLISHED',
    });
  });
});
