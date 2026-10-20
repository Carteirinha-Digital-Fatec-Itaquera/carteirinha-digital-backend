import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  VisitorService,
  tokenHash,
  visitorIdentityHash,
} from './visitor.service';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { RegisterVisitorDto, VerifyVisitorDto } from './public-events.dto';

describe('VisitorService - Identificação sem OTP e Sessão Direta', () => {
  let service: VisitorService;
  let prismaMock: any;
  let mailMock: any;

  const validSeries = {
    id: 'series-uuid-1',
    published: true,
    retentionAt: new Date(Date.now() + 86400000),
    purgedAt: null,
    courses: ['DSM', 'GE'],
    cpfRequired: false,
  };

  beforeEach(() => {
    prismaMock = {
      eventRateLimit: {
        upsert: jest.fn().mockResolvedValue({ count: 1 }),
      },
      eventSeries: {
        findUnique: jest.fn().mockResolvedValue(validSeries),
      },
      visitorRegistration: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      visitorSession: {
        findUnique: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      event: {
        findUnique: jest.fn(),
      },
      eventParticipant: {
        upsert: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => {
        return callback(prismaMock);
      }),
      $queryRaw: jest.fn().mockResolvedValue([
        { purgedAt: null, retentionAt: validSeries.retentionAt },
      ]),
    };

    mailMock = {
      sendVisitorCode: jest.fn(),
      sendVisitorCertificate: jest.fn(),
    };

    service = new VisitorService(
      prismaMock as unknown as PrismaService,
      mailMock as unknown as MailService,
    );
  });

  describe('register', () => {
    const validDto: RegisterVisitorDto = {
      seriesId: 'series-uuid-1',
      name: 'Visitante Teste',
      email: 'visitante@example.com',
      course: 'DSM',
    };

    it('cria identificação autodeclarada e sessão temporária diretamente sem enviar e-mail', async () => {
      prismaMock.visitorRegistration.findUnique.mockResolvedValue(null);
      prismaMock.visitorRegistration.create.mockResolvedValue({
        id: 'visitor-reg-1',
        seriesId: validDto.seriesId,
        name: validDto.name,
        email: 'visitante@example.com',
        identifiedAt: new Date(),
        verifiedAt: null,
      });
      prismaMock.visitorSession.create.mockResolvedValue({
        id: 'session-1',
      });

      const result = await service.register(validDto, '127.0.0.1');

      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('expiresAt');
      expect(result).toHaveProperty('visitorId', 'visitor-reg-1');

      // Garante que não envia e-mail com código
      expect(mailMock.sendVisitorCode).not.toHaveBeenCalled();

      // Garante que identifiedAt é preenchido e verifiedAt permanece null (autodeclarado)
      expect(prismaMock.visitorRegistration.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          seriesId: validDto.seriesId,
          name: validDto.name,
          email: 'visitante@example.com',
          identifiedAt: expect.any(Date),
          verifiedAt: null,
        }),
      });

      // Garante que salva apenas o hash do token da sessão
      expect(prismaMock.visitorSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          visitorId: 'visitor-reg-1',
          tokenHash: tokenHash(result.token),
          expiresAt: expect.any(Date),
        }),
      });
    });

    it('reutiliza a sessão se o cadastro existir e o cliente apresentar token de sessão válido para aquele cadastro', async () => {
      const existingVisitor = {
        id: 'visitor-reg-existing',
        seriesId: validDto.seriesId,
        name: validDto.name,
        email: 'visitante@example.com',
        identifiedAt: new Date(),
        verifiedAt: null,
      };
      prismaMock.visitorRegistration.findUnique.mockResolvedValue(existingVisitor);

      const validToken = 'valid-token-for-visitor-test-12345678901234';
      const validSession = {
        id: 'session-existing',
        visitorId: existingVisitor.id,
        tokenHash: tokenHash(validToken),
        expiresAt: new Date(Date.now() + 3600000),
      };
      prismaMock.visitorSession.findUnique.mockResolvedValue(validSession);

      const result = await service.register(validDto, '127.0.0.1', validToken);

      expect(result.token).toBe(validToken);
      expect(result.visitorId).toBe(existingVisitor.id);
      expect(prismaMock.visitorRegistration.create).not.toHaveBeenCalled();
    });

    it('rejeita com ConflictException genérica se cadastro já existe e cliente não possui sessão válida (protege histórico)', async () => {
      const existingVisitor = {
        id: 'visitor-reg-someone-else',
        seriesId: validDto.seriesId,
        name: 'Outra Pessoa',
        email: 'visitante@example.com',
        identifiedAt: new Date(),
        verifiedAt: null,
      };
      prismaMock.visitorRegistration.findUnique.mockResolvedValue(existingVisitor);

      // Sem token de sessão
      await expect(service.register(validDto, '127.0.0.1')).rejects.toThrow(
        ConflictException,
      );

      // Com token expirado ou pertencente a outro visitante
      prismaMock.visitorSession.findUnique.mockResolvedValue({
        id: 'session-other',
        visitorId: 'different-visitor-id',
        expiresAt: new Date(Date.now() + 3600000),
      });

      await expect(
        service.register(validDto, '127.0.0.1', 'another-user-session-token-12345678901234'),
      ).rejects.toThrow(ConflictException);

      expect(prismaMock.visitorRegistration.create).not.toHaveBeenCalled();
    });

    it('valida CPF quando obrigatório pela edição', async () => {
      prismaMock.eventSeries.findUnique.mockResolvedValue({
        ...validSeries,
        cpfRequired: true,
      });

      // Sem CPF quando obrigatório
      await expect(
        service.register({ ...validDto, cpf: undefined }, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);

      // Com CPF inválido
      await expect(
        service.register({ ...validDto, cpf: '11111111111' }, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita CPF se a edição não solicitar CPF', async () => {
      prismaMock.eventSeries.findUnique.mockResolvedValue({
        ...validSeries,
        cpfRequired: false,
      });

      await expect(
        service.register({ ...validDto, cpf: '12345678901' }, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita curso que não pertence à edição', async () => {
      await expect(
        service.register({ ...validDto, course: 'CURSO_INEXISTENTE' }, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita inscrição se a edição não estiver publicada ou já estiver retida/expurgada', async () => {
      prismaMock.eventSeries.findUnique.mockResolvedValue({
        ...validSeries,
        published: false,
      });

      await expect(service.register(validDto, '127.0.0.1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('session', () => {
    it('retorna os dados do visitante para sessão autodeclarada (identifiedAt)', async () => {
      const token = 'sample-valid-token-for-session-lookup-12345';
      const visitor = {
        id: 'visitor-1',
        name: 'Visitante Autodeclarado',
        course: 'DSM',
        seriesId: 'series-uuid-1',
        identifiedAt: new Date(),
        verifiedAt: null,
        series: validSeries,
      };
      prismaMock.visitorSession.findUnique.mockResolvedValue({
        visitorId: visitor.id,
        expiresAt: new Date(Date.now() + 3600000),
        visitor,
      });

      const result = await service.session(token);
      expect(result.id).toBe(visitor.id);
      expect(result.identifiedAt).toBeDefined();
      expect(result.verifiedAt).toBeNull();
    });

    it('retorna os dados do visitante para sessão legada com e-mail verificado (verifiedAt)', async () => {
      const token = 'sample-valid-token-for-session-lookup-12345';
      const visitor = {
        id: 'visitor-legacy',
        name: 'Visitante Legado',
        course: 'DSM',
        seriesId: 'series-uuid-1',
        identifiedAt: null,
        verifiedAt: new Date(),
        series: validSeries,
      };
      prismaMock.visitorSession.findUnique.mockResolvedValue({
        visitorId: visitor.id,
        expiresAt: new Date(Date.now() + 3600000),
        visitor,
      });

      const result = await service.session(token);
      expect(result.id).toBe(visitor.id);
      expect(result.verifiedAt).toBeDefined();
    });

    it('lança UnauthorizedException se a sessão expirou', async () => {
      const token = 'sample-valid-token-for-session-lookup-12345';
      prismaMock.visitorSession.findUnique.mockResolvedValue({
        visitorId: 'visitor-1',
        expiresAt: new Date(Date.now() - 1000),
        visitor: {
          id: 'visitor-1',
          identifiedAt: new Date(),
          series: validSeries,
        },
      });

      await expect(service.session(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('lança UnauthorizedException se o visitante não possui nem identifiedAt nem verifiedAt', async () => {
      const token = 'sample-valid-token-for-session-lookup-12345';
      prismaMock.visitorSession.findUnique.mockResolvedValue({
        visitorId: 'visitor-unverified',
        expiresAt: new Date(Date.now() + 3600000),
        visitor: {
          id: 'visitor-unverified',
          identifiedAt: null,
          verifiedAt: null,
          series: validSeries,
        },
      });

      await expect(service.session(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('participant', () => {
    const validEvent = {
      id: 'event-uuid-1',
      seriesId: 'series-uuid-1',
      visitorsAllowed: true,
      status: 'SCHEDULED',
    };

    it('permite inscrição de visitante com identificação autodeclarada (identifiedAt)', async () => {
      prismaMock.visitorRegistration.findUnique.mockResolvedValue({
        id: 'visitor-1',
        name: 'Visitante Autodeclarado',
        course: 'DSM',
        seriesId: 'series-uuid-1',
        identifiedAt: new Date(),
        verifiedAt: null,
        series: validSeries,
      });
      prismaMock.event.findUnique.mockResolvedValue(validEvent);
      prismaMock.eventParticipant.upsert.mockResolvedValue({
        id: 'participant-1',
        eventId: validEvent.id,
        visitorId: 'visitor-1',
      });

      const participant = await service.participant('visitor-1', validEvent.id);
      expect(participant.id).toBe('participant-1');
      expect(prismaMock.eventParticipant.upsert).toHaveBeenCalled();
    });

    it('permite inscrição de visitante legado verificado (verifiedAt)', async () => {
      prismaMock.visitorRegistration.findUnique.mockResolvedValue({
        id: 'visitor-legacy',
        name: 'Visitante Legado',
        course: 'DSM',
        seriesId: 'series-uuid-1',
        identifiedAt: null,
        verifiedAt: new Date(),
        series: validSeries,
      });
      prismaMock.event.findUnique.mockResolvedValue(validEvent);
      prismaMock.eventParticipant.upsert.mockResolvedValue({
        id: 'participant-legacy',
        eventId: validEvent.id,
        visitorId: 'visitor-legacy',
      });

      const participant = await service.participant('visitor-legacy', validEvent.id);
      expect(participant.id).toBe('participant-legacy');
    });

    it('rejeita visitante se o evento não permitir visitantes', async () => {
      prismaMock.visitorRegistration.findUnique.mockResolvedValue({
        id: 'visitor-1',
        identifiedAt: new Date(),
        seriesId: 'series-uuid-1',
        series: validSeries,
      });
      prismaMock.event.findUnique.mockResolvedValue({
        ...validEvent,
        visitorsAllowed: false,
      });

      await expect(service.participant('visitor-1', validEvent.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejeita visitante se a edição da série for diferente da do evento', async () => {
      prismaMock.visitorRegistration.findUnique.mockResolvedValue({
        id: 'visitor-1',
        identifiedAt: new Date(),
        seriesId: 'series-uuid-OUTRA',
        series: validSeries,
      });
      prismaMock.event.findUnique.mockResolvedValue(validEvent);

      await expect(service.participant('visitor-1', validEvent.id)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
