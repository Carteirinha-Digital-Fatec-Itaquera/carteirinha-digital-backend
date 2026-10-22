import { BadRequestException } from '@nestjs/common';
import { EventManagementController } from './public-events.controller';
import { PrismaService } from '../database/prisma.service';
import { EventCatalogService } from './event-catalog.service';
import { EventOperationsService } from './event-operations.service';
import { TechnologyPdfService } from '../certificate/technology-pdf.service';
import { EventStorageService } from './event-storage.service';
import type { Response } from 'express';

describe('EventManagementController - Certificate Preview with Draft', () => {
  let controller: EventManagementController;
  let prisma: any;
  let catalog: any;
  let operations: any;
  let pdf: any;
  let storage: any;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    prisma = {
      certificateTemplate: {
        findUniqueOrThrow: jest.fn(),
      },
      certificateSigner: {
        findMany: jest.fn(),
      },
    };
    catalog = {};
    operations = {};
    pdf = {
      render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4-mock-preview')),
    };
    storage = {};
    mockResponse = {
      type: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };

    controller = new EventManagementController(
      prisma as PrismaService,
      catalog as EventCatalogService,
      operations as EventOperationsService,
      pdf as TechnologyPdfService,
      storage as EventStorageService,
    );
  });

  it('deve rejeitar se signerIds for vazio ou tiver mais de 3 itens', async () => {
    await expect(
      controller.preview(
        'template-1',
        { signerIds: [] },
        mockResponse as Response,
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      controller.preview(
        'template-1',
        { signerIds: ['s1', 's2', 's3', 's4'] },
        mockResponse as Response,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('deve rejeitar se signerIds contiver assinantes duplicados', async () => {
    await expect(
      controller.preview(
        'template-1',
        { signerIds: ['s1', 's1'] },
        mockResponse as Response,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('deve rejeitar se algum assinante estiver arquivado ou inexistente', async () => {
    prisma.certificateTemplate.findUniqueOrThrow.mockResolvedValue({
      id: 'template-1',
      role: 'ATTENDEE',
      version: 1,
      config: { heading: 'CERTIFICADO', edition: 'XIII Semana' },
    });
    prisma.certificateSigner.findMany.mockResolvedValue([
      { id: 's1', name: 'Assinante 1', title: 'Diretor', assetId: 'a1' },
      // s2 não retornado pois está arquivado
    ]);

    await expect(
      controller.preview(
        'template-1',
        { signerIds: ['s1', 's2'] },
        mockResponse as Response,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('deve preservar a ordem estrita dos assinantes conforme signerIds', async () => {
    prisma.certificateTemplate.findUniqueOrThrow.mockResolvedValue({
      id: 'template-1',
      role: 'ATTENDEE',
      version: 1,
      config: { heading: 'CERTIFICADO', edition: 'XIII Semana' },
    });
    // findMany retorna s2 antes de s1 acidentalmente do banco
    prisma.certificateSigner.findMany.mockResolvedValue([
      { id: 's2', name: 'Assinante 2', title: 'Coordenador', assetId: 'a2' },
      { id: 's1', name: 'Assinante 1', title: 'Diretor', assetId: 'a1' },
    ]);

    await controller.preview(
      'template-1',
      { signerIds: ['s1', 's2'] },
      mockResponse as Response,
    );

    expect(pdf.render).toHaveBeenCalled();
    const renderCall = pdf.render.mock.calls[0];
    const snapshot = renderCall[0].payloadSnapshot;
    expect(renderCall[1]).toBe(true); // preview flag is true
    // A ordem deve ser estritamente s1, depois s2!
    expect(snapshot.signers[0].id).toBe('s1');
    expect(snapshot.signers[1].id).toBe('s2');
  });

  it('deve preencher o snapshot com os dados do rascunho informados no DTO', async () => {
    prisma.certificateTemplate.findUniqueOrThrow.mockResolvedValue({
      id: 'template-1',
      role: 'ATTENDEE',
      version: 1,
      config: { heading: 'CERTIFICADO', edition: 'XIII Semana' },
    });
    prisma.certificateSigner.findMany.mockResolvedValue([
      { id: 's1', name: 'Assinante 1', title: 'Diretor', assetId: 'a1' },
    ]);

    await controller.preview(
      'template-1',
      {
        signerIds: ['s1'],
        eventTitle: 'Palestra de Inteligência Artificial e Robótica',
        speaker: 'Dra. Maria Silva',
        promoter: 'Empresa Parceira XPTO',
        startsAt: '2026-11-10T14:00:00.000Z',
        endsAt: '2026-11-10T17:00:00.000Z',
        workload: '3 horas',
      },
      mockResponse as Response,
    );

    const snapshot = pdf.render.mock.calls[0][0].payloadSnapshot;
    expect(snapshot.eventTitle).toBe(
      'Palestra de Inteligência Artificial e Robótica',
    );
    expect(snapshot.speaker).toBe('Dra. Maria Silva');
    expect(snapshot.promoter).toBe('Empresa Parceira XPTO');
    expect(snapshot.startsAt).toBe('2026-11-10T14:00:00.000Z');
    expect(snapshot.endsAt).toBe('2026-11-10T17:00:00.000Z');
    expect(snapshot.workload).toBe('3 horas');
    expect(snapshot.eventDate).toBe('2026-11-10');
  });

  it('deve usar o nome do palestrante como studentName na prévia para modelo SPEAKER', async () => {
    prisma.certificateTemplate.findUniqueOrThrow.mockResolvedValue({
      id: 'template-speaker',
      role: 'SPEAKER',
      version: 1,
      config: { heading: 'CERTIFICADO', edition: 'XIII Semana' },
    });
    prisma.certificateSigner.findMany.mockResolvedValue([
      { id: 's1', name: 'Assinante 1', title: 'Diretor', assetId: 'a1' },
    ]);

    await controller.preview(
      'template-speaker',
      {
        signerIds: ['s1'],
        speaker: 'Prof. Carlos Santos',
      },
      mockResponse as Response,
    );

    const snapshot = pdf.render.mock.calls[0][0].payloadSnapshot;
    expect(snapshot.role).toBe('SPEAKER');
    expect(snapshot.studentName).toBe('Prof. Carlos Santos');
  });
});
