import { BadRequestException } from '@nestjs/common';
import { EventManagementController } from './public-events.controller';
import { PrismaService } from '../database/prisma.service';
import { EventCatalogService } from './event-catalog.service';
import { EventOperationsService } from './event-operations.service';
import { TechnologyPdfService } from '../certificate/technology-pdf.service';
import { PdfGeneratorService } from '../certificate/pdf-generator.service';
import { EventStorageService } from './event-storage.service';
import type { Response } from 'express';
import type { CertificateSnapshot } from '../certificate/certificate.snapshot';

interface GeneratePdfCallArg {
  verificationCode: string;
  payloadSnapshot: CertificateSnapshot;
}

interface RenderCallArg {
  payloadSnapshot: CertificateSnapshot;
}

describe('EventManagementController - Certificate Preview with Draft', () => {
  let controller: EventManagementController;
  let prisma: {
    certificateTemplate: {
      findUniqueOrThrow: jest.Mock;
    };
    certificateSigner: {
      findMany: jest.Mock;
    };
  };
  let catalog: unknown;
  let operations: unknown;
  let pdf: {
    render: jest.Mock<Promise<Buffer>, [RenderCallArg, boolean]>;
  };
  let pdfGenerator: {
    generatePdf: jest.Mock<Promise<Buffer>, [GeneratePdfCallArg]>;
  };
  let storage: unknown;
  let mockResponse: {
    type: jest.Mock;
    send: jest.Mock;
    setHeader: jest.Mock;
  };

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
      render: jest
        .fn<Promise<Buffer>, [RenderCallArg, boolean]>()
        .mockResolvedValue(Buffer.from('%PDF-1.4-mock-preview-v2')),
    };
    pdfGenerator = {
      generatePdf: jest
        .fn<Promise<Buffer>, [GeneratePdfCallArg]>()
        .mockResolvedValue(Buffer.from('%PDF-1.4-mock-preview-default')),
    };
    storage = {};
    mockResponse = {
      type: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
    };

    controller = new EventManagementController(
      prisma as unknown as PrismaService,
      catalog as EventCatalogService,
      operations as EventOperationsService,
      pdf as unknown as TechnologyPdfService,
      storage as EventStorageService,
      pdfGenerator as unknown as PdfGeneratorService,
    );
  });

  describe('Modelo Institucional Padrão (id = default)', () => {
    it('deve gerar PDF do modelo institucional padrão com PdfGeneratorService sem consultar template no banco', async () => {
      await controller.preview(
        'default',
        {
          eventTitle: 'Seminário de Boas-Vindas',
          speaker: 'Prof. Coordenador',
          startsAt: '2026-10-26T22:00:00.000Z', // 19h no fuso America/Sao_Paulo (UTC-3)
          workloadMinutes: 90,
        },
        mockResponse as unknown as Response,
      );

      expect(pdfGenerator.generatePdf).toHaveBeenCalledTimes(1);
      const callArg = pdfGenerator.generatePdf.mock.calls[0][0];
      expect(callArg.verificationCode).toBe('DEMONSTRACAO-SEM-VALIDADE');
      expect(callArg.payloadSnapshot.eventTitle).toBe(
        'Seminário de Boas-Vindas',
      );
      expect(callArg.payloadSnapshot.speaker).toBe('Prof. Coordenador');
      // No fuso America/Sao_Paulo, 22:00 UTC do dia 26/10 é 19:00 do dia 26/10
      expect(callArg.payloadSnapshot.eventDate).toBe('2026-10-26');
      expect(callArg.payloadSnapshot.workload).toBe('1 hora e 30 minutos');
      expect(mockResponse.type).toHaveBeenCalledWith('application/pdf');
      expect(mockResponse.send).toHaveBeenCalled();
    });

    it('deve preservar data de São Paulo mesmo em virada de dia em UTC', async () => {
      // 22h em São Paulo = 01:00 UTC do dia seguinte
      await controller.preview(
        'default',
        {
          eventTitle: 'Palestra Noturna',
          startsAt: '2026-10-27T01:00:00.000Z',
          workloadMinutes: 60,
        },
        mockResponse as unknown as Response,
      );

      const callArg = pdfGenerator.generatePdf.mock.calls[0][0];
      expect(callArg.payloadSnapshot.eventDate).toBe('2026-10-26');
      expect(callArg.payloadSnapshot.workload).toBe('1 hora');
    });
  });

  describe('Modelo Personalizado V2 (id = UUID)', () => {
    const validUuid = '11111111-2222-4333-8444-555555555555';

    it('deve rejeitar se o id não for default nem UUID válido', async () => {
      await expect(
        controller.preview(
          'id-invalido',
          { signerIds: ['11111111-2222-4333-8444-555555555551'] },
          mockResponse as unknown as Response,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve rejeitar se signerIds for vazio ou tiver mais de 3 itens', async () => {
      await expect(
        controller.preview(
          validUuid,
          { signerIds: [] },
          mockResponse as unknown as Response,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.preview(
          validUuid,
          { signerIds: ['s1', 's2', 's3', 's4'] },
          mockResponse as unknown as Response,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve rejeitar se signerIds contiver assinantes duplicados', async () => {
      await expect(
        controller.preview(
          validUuid,
          { signerIds: ['s1', 's1'] },
          mockResponse as unknown as Response,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve rejeitar se algum assinante estiver arquivado ou inexistente', async () => {
      prisma.certificateTemplate.findUniqueOrThrow.mockResolvedValue({
        id: validUuid,
        role: 'ATTENDEE',
        version: 1,
        config: { heading: 'CERTIFICADO', edition: 'XIII Semana' },
      });
      prisma.certificateSigner.findMany.mockResolvedValue([
        { id: 's1', name: 'Assinante 1', title: 'Diretor', assetId: 'a1' },
      ]);

      await expect(
        controller.preview(
          validUuid,
          { signerIds: ['s1', 's2'] },
          mockResponse as unknown as Response,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve preservar a ordem estrita dos assinantes conforme signerIds', async () => {
      prisma.certificateTemplate.findUniqueOrThrow.mockResolvedValue({
        id: validUuid,
        role: 'ATTENDEE',
        version: 1,
        config: { heading: 'CERTIFICADO', edition: 'XIII Semana' },
      });
      prisma.certificateSigner.findMany.mockResolvedValue([
        { id: 's2', name: 'Assinante 2', title: 'Coordenador', assetId: 'a2' },
        { id: 's1', name: 'Assinante 1', title: 'Diretor', assetId: 'a1' },
      ]);

      await controller.preview(
        validUuid,
        { signerIds: ['s1', 's2'] },
        mockResponse as unknown as Response,
      );

      expect(pdf.render).toHaveBeenCalled();
      const renderCall = pdf.render.mock.calls[0];
      const snapshot = renderCall[0].payloadSnapshot;
      expect(renderCall[1]).toBe(true);
      expect(snapshot.signers[0].id).toBe('s1');
      expect(snapshot.signers[1].id).toBe('s2');
    });

    it('deve preencher o snapshot com os dados do rascunho informados no DTO convertendo datas em America/Sao_Paulo', async () => {
      prisma.certificateTemplate.findUniqueOrThrow.mockResolvedValue({
        id: validUuid,
        role: 'ATTENDEE',
        version: 1,
        config: { heading: 'CERTIFICADO', edition: 'XIII Semana' },
      });
      prisma.certificateSigner.findMany.mockResolvedValue([
        { id: 's1', name: 'Assinante 1', title: 'Diretor', assetId: 'a1' },
      ]);

      await controller.preview(
        validUuid,
        {
          signerIds: ['s1'],
          eventTitle: 'Palestra de Inteligência Artificial e Robótica',
          speaker: 'Dra. Maria Silva',
          promoter: 'Empresa Parceira XPTO',
          startsAt: '2026-11-10T17:00:00.000Z', // 14h em SP
          endsAt: '2026-11-10T20:00:00.000Z', // 17h em SP
          workloadMinutes: 180,
        },
        mockResponse as unknown as Response,
      );

      const snapshot = pdf.render.mock.calls[0][0].payloadSnapshot;
      expect(snapshot.eventTitle).toBe(
        'Palestra de Inteligência Artificial e Robótica',
      );
      expect(snapshot.speaker).toBe('Dra. Maria Silva');
      expect(snapshot.promoter).toBe('Empresa Parceira XPTO');
      expect(snapshot.startsAt).toBe('2026-11-10T17:00:00.000Z');
      expect(snapshot.endsAt).toBe('2026-11-10T20:00:00.000Z');
      expect(snapshot.workload).toBe('3 horas');
      expect(snapshot.eventDate).toBe('2026-11-10');
    });

    it('deve usar o nome do palestrante como studentName na prévia para modelo SPEAKER', async () => {
      prisma.certificateTemplate.findUniqueOrThrow.mockResolvedValue({
        id: validUuid,
        role: 'SPEAKER',
        version: 1,
        config: { heading: 'CERTIFICADO', edition: 'XIII Semana' },
      });
      prisma.certificateSigner.findMany.mockResolvedValue([
        { id: 's1', name: 'Assinante 1', title: 'Diretor', assetId: 'a1' },
      ]);

      await controller.preview(
        validUuid,
        {
          signerIds: ['s1'],
          speaker: 'Prof. Carlos Santos',
        },
        mockResponse as unknown as Response,
      );

      const snapshot = pdf.render.mock.calls[0][0].payloadSnapshot;
      expect(snapshot.role).toBe('SPEAKER');
      expect(snapshot.studentName).toBe('Prof. Carlos Santos');
    });
  });
});
