import { NotFoundException } from '@nestjs/common';
import { EventOperationsService } from './event-operations.service';
import { PrismaService } from '../database/prisma.service';
import { CertificateService } from '../certificate/certificate.service';
import { EventStorageService } from './event-storage.service';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateEventFeedbackDto } from './public-events.dto';

describe('EventFeedback - Avaliação e Métricas de Satisfação Anônimas', () => {
  let service: EventOperationsService;
  let prismaMock: {
    event: {
      findUnique: jest.Mock;
    };
    eventFeedback: {
      create: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(() => {
    prismaMock = {
      event: {
        findUnique: jest.fn(),
      },
      eventFeedback: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };

    service = new EventOperationsService(
      prismaMock as unknown as PrismaService,
      {} as unknown as CertificateService,
      {} as unknown as EventStorageService,
    );
  });

  describe('submitFeedback (Submissão Anônima)', () => {
    it('lança NotFoundException se o evento não existir', async () => {
      prismaMock.event.findUnique.mockResolvedValue(null);

      await expect(
        service.submitFeedback('evt-inexistente', { rating: 5 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('registra o feedback de forma 100% anônima sem dados de usuário', async () => {
      prismaMock.event.findUnique.mockResolvedValue({
        id: 'evt-123',
        title: 'Palestra de Inovação',
      });

      prismaMock.eventFeedback.create.mockResolvedValue({
        id: 'fb-1',
        eventId: 'evt-123',
        rating: 5,
        comments: 'Excelente palestra, muito prática!',
        suggestions: 'Mais oficinas mão na massa.',
        createdAt: new Date(),
      });

      const result = await service.submitFeedback('evt-123', {
        rating: 5,
        comments: '  Excelente palestra, muito prática!  ',
        suggestions: '  Mais oficinas mão na massa.  ',
      });

      expect(result.success).toBe(true);
      expect(prismaMock.eventFeedback.create).toHaveBeenCalledWith({
        data: {
          eventId: 'evt-123',
          rating: 5,
          comments: 'Excelente palestra, muito prática!',
          suggestions: 'Mais oficinas mão na massa.',
        },
      });

      // Validação de garantia de anonimato: nenhum dado pessoal passado para o create
      const callData = prismaMock.eventFeedback.create.mock.calls[0][0].data;
      expect(callData).not.toHaveProperty('studentRa');
      expect(callData).not.toHaveProperty('studentId');
      expect(callData).not.toHaveProperty('visitorId');
      expect(callData).not.toHaveProperty('email');
      expect(callData).not.toHaveProperty('ip');
    });

    it('permite registrar feedback apenas com a nota obrigatória (comentários opcionais)', async () => {
      prismaMock.event.findUnique.mockResolvedValue({
        id: 'evt-123',
        title: 'Palestra de Inovação',
      });

      prismaMock.eventFeedback.create.mockResolvedValue({
        id: 'fb-2',
        eventId: 'evt-123',
        rating: 4,
        comments: null,
        suggestions: null,
        createdAt: new Date(),
      });

      const result = await service.submitFeedback('evt-123', { rating: 4 });

      expect(result.success).toBe(true);
      expect(prismaMock.eventFeedback.create).toHaveBeenCalledWith({
        data: {
          eventId: 'evt-123',
          rating: 4,
          comments: null,
          suggestions: null,
        },
      });
    });
  });

  describe('getFeedbackMetrics (Métricas Agregadas para Secretaria)', () => {
    it('lança NotFoundException se o evento não existir', async () => {
      prismaMock.event.findUnique.mockResolvedValue(null);

      await expect(service.getFeedbackMetrics('evt-404')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('calcula métricas agregadas e distribuição de estrelas corretamente', async () => {
      prismaMock.event.findUnique.mockResolvedValue({
        id: 'evt-100',
        title: 'Workshop de Cloud',
      });

      const mockFeedbacks = [
        {
          id: 'fb-1',
          rating: 5,
          comments: 'Top demais!',
          suggestions: 'Kubernetes',
          createdAt: new Date('2026-10-16T18:00:00Z'),
        },
        {
          id: 'fb-2',
          rating: 5,
          comments: 'Muito bom!',
          suggestions: null,
          createdAt: new Date('2026-10-16T18:05:00Z'),
        },
        {
          id: 'fb-3',
          rating: 4,
          comments: 'Gostei bastante.',
          suggestions: 'Mais tempo de prática',
          createdAt: new Date('2026-10-16T18:10:00Z'),
        },
        {
          id: 'fb-4',
          rating: 2,
          comments: 'Áudio um pouco baixo.',
          suggestions: 'Melhorar som',
          createdAt: new Date('2026-10-16T18:15:00Z'),
        },
      ];

      prismaMock.eventFeedback.findMany.mockResolvedValue(mockFeedbacks);

      const metrics = await service.getFeedbackMetrics('evt-100');

      expect(metrics.eventId).toBe('evt-100');
      expect(metrics.eventTitle).toBe('Workshop de Cloud');
      expect(metrics.totalResponses).toBe(4);
      // Média: (5 + 5 + 4 + 2) / 4 = 16 / 4 = 4.0
      expect(metrics.averageRating).toBe(4.0);
      expect(metrics.ratingDistribution).toEqual({
        1: 0,
        2: 1,
        3: 0,
        4: 1,
        5: 2,
      });
      expect(metrics.feedbacks).toHaveLength(4);
      // Confirma que nenhum feedback tem dados de aluno ou visitante
      for (const item of metrics.feedbacks) {
        expect(item).not.toHaveProperty('studentRa');
        expect(item).not.toHaveProperty('visitorId');
      }
    });

    it('retorna métricas zeradas quando não há nenhuma avaliação registrada', async () => {
      prismaMock.event.findUnique.mockResolvedValue({
        id: 'evt-empty',
        title: 'Palestra Futura',
      });

      prismaMock.eventFeedback.findMany.mockResolvedValue([]);

      const metrics = await service.getFeedbackMetrics('evt-empty');

      expect(metrics.totalResponses).toBe(0);
      expect(metrics.averageRating).toBe(0);
      expect(metrics.ratingDistribution).toEqual({
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
      });
      expect(metrics.feedbacks).toEqual([]);
    });
  });

  describe('CreateEventFeedbackDto Validation', () => {
    it('valida com sucesso quando os campos estão corretos', async () => {
      const dto = plainToInstance(CreateEventFeedbackDto, {
        rating: 5,
        comments: 'Ótimo evento!',
        suggestions: 'Trazer mais palestrantes externos',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('rejeita quando a nota é menor que 1 ou maior que 5', async () => {
      const invalidLow = plainToInstance(CreateEventFeedbackDto, { rating: 0 });
      const errorsLow = await validate(invalidLow);
      expect(errorsLow.length).toBeGreaterThan(0);

      const invalidHigh = plainToInstance(CreateEventFeedbackDto, { rating: 6 });
      const errorsHigh = await validate(invalidHigh);
      expect(errorsHigh.length).toBeGreaterThan(0);
    });

    it('rejeita quando a nota não é inteira', async () => {
      const decimalDto = plainToInstance(CreateEventFeedbackDto, {
        rating: 4.5,
      });
      const errors = await validate(decimalDto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
