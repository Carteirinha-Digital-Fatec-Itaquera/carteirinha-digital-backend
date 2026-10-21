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

interface MockPrisma {
  eventRateLimit: {
    upsert: jest.Mock;
  };
  eventSeries: {
    findUnique: jest.Mock;
  };
  visitorRegistration: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  visitorSession: {
    findUnique: jest.Mock;
    create: jest.Mock;
    deleteMany: jest.Mock;
  };
  event: {
    findUnique: jest.Mock;
  };
  eventParticipant: {
    upsert: jest.Mock;
  };
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
}

interface MockMail {
  sendVisitorCode: jest.Mock;
  sendVisitorCertificate: jest.Mock;
}

describe('VisitorService - Identificação sem OTP e Sessão Direta', () => {
  let service: VisitorService;
  let prismaMock: MockPrisma;
  let mailMock: MockMail;

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
      $transaction: jest
        .fn()
        .mockImplementation(
          async (callback: (tx: MockPrisma) => Promise<unknown>) => {
            return callback(prismaMock);
          },
        ),
      $queryRaw: jest
        .fn()
        .mockResolvedValue([
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

      expect(mailMock.sendVisitorCode).not.toHaveBeenCalled();

      const createCall = (
        prismaMock.visitorRegistration.create.mock.calls as unknown as [
          {
            data: {
              seriesId: string;
              name: string;
              email: string;
              identifiedAt: unknown;
              verifiedAt: unknown;
            };
          },
        ][]
      )[0][0];
      expect(createCall.data.seriesId).toBe(validDto.seriesId);
      expect(createCall.data.name).toBe(validDto.name);
      expect(createCall.data.email).toBe('visitante@example.com');
      expect(createCall.data.identifiedAt).toBeInstanceOf(Date);
      expect(createCall.data.verifiedAt).toBeNull();

      const sessionCall = (
        prismaMock.visitorSession.create.mock.calls as unknown as [
          {
            data: { visitorId: string; tokenHash: string; expiresAt: unknown };
          },
        ][]
      )[0][0];
      expect(sessionCall.data.visitorId).toBe('visitor-reg-1');
      expect(sessionCall.data.tokenHash).toBe(tokenHash(result.token));
      expect(sessionCall.data.expiresAt).toBeInstanceOf(Date);
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
      prismaMock.visitorRegistration.findUnique.mockResolvedValue(
        existingVisitor,
      );

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

    it('rejeita com ConflictException se cadastro já existe e cliente não possui sessão válida', async () => {
      const existingVisitor = {
        id: 'visitor-reg-someone-else',
        seriesId: validDto.seriesId,
        name: 'Outra Pessoa',
        email: 'visitante@example.com',
        identifiedAt: new Date(),
        verifiedAt: null,
      };
      prismaMock.visitorRegistration.findUnique.mockResolvedValue(
        existingVisitor,
      );

      await expect(service.register(validDto, '127.0.0.1')).rejects.toThrow(
        ConflictException,
      );

      prismaMock.visitorSession.findUnique.mockResolvedValue({
        id: 'session-other',
        visitorId: 'different-visitor-id',
        expiresAt: new Date(Date.now() + 3600000),
      });

      await expect(
        service.register(
          validDto,
          '127.0.0.1',
          'another-user-session-token-12345678901234',
        ),
      ).rejects.toThrow(ConflictException);

      expect(prismaMock.visitorRegistration.create).not.toHaveBeenCalled();
    });

    it('valida CPF quando obrigatório pela edição', async () => {
      prismaMock.eventSeries.findUnique.mockResolvedValue({
        ...validSeries,
        cpfRequired: true,
      });

      await expect(
        service.register({ ...validDto, cpf: undefined }, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);

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
        service.register(
          { ...validDto, course: 'CURSO_INEXISTENTE' },
          '127.0.0.1',
        ),
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

  describe('verify', () => {
    const verifyDto: VerifyVisitorDto = {
      registrationId: '00000000-0000-4000-8000-000000000001',
      code: '123456',
    };

    it('rejeita verificação de cadastro autodeclarado (identifiedAt) mesmo com registrationId conhecido', async () => {
      prismaMock.visitorRegistration.findUnique
        .mockResolvedValueOnce({ seriesId: 'series-uuid-1' })
        .mockResolvedValueOnce({
          id: verifyDto.registrationId,
          seriesId: 'series-uuid-1',
          identifiedAt: new Date(),
          verifiedAt: null,
          otpHash: null,
          otpExpiresAt: null,
          otpAttempts: 0,
          series: validSeries,
        });

      await expect(service.verify(verifyDto, '127.0.0.1')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prismaMock.visitorSession.create).not.toHaveBeenCalled();
    });

    it('rejeita com UnauthorizedException quando o cadastro não existe', async () => {
      prismaMock.visitorRegistration.findUnique.mockResolvedValue(null);

      await expect(service.verify(verifyDto, '127.0.0.1')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejeita código legado expirado', async () => {
      prismaMock.visitorRegistration.findUnique
        .mockResolvedValueOnce({ seriesId: 'series-uuid-1' })
        .mockResolvedValueOnce({
          id: verifyDto.registrationId,
          seriesId: 'series-uuid-1',
          identifiedAt: null,
          verifiedAt: null,
          otpHash: visitorIdentityHash('123456'),
          otpExpiresAt: new Date(Date.now() - 1000),
          otpAttempts: 0,
          series: validSeries,
        });

      await expect(service.verify(verifyDto, '127.0.0.1')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejeita quando exceder 5 tentativas de OTP legado', async () => {
      prismaMock.visitorRegistration.findUnique
        .mockResolvedValueOnce({ seriesId: 'series-uuid-1' })
        .mockResolvedValueOnce({
          id: verifyDto.registrationId,
          seriesId: 'series-uuid-1',
          identifiedAt: null,
          verifiedAt: null,
          otpHash: visitorIdentityHash('123456'),
          otpExpiresAt: new Date(Date.now() + 600000),
          otpAttempts: 5,
          series: validSeries,
        });

      await expect(service.verify(verifyDto, '127.0.0.1')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejeita código OTP legado incorreto e incrementa tentativas', async () => {
      prismaMock.visitorRegistration.findUnique
        .mockResolvedValueOnce({ seriesId: 'series-uuid-1' })
        .mockResolvedValueOnce({
          id: verifyDto.registrationId,
          seriesId: 'series-uuid-1',
          identifiedAt: null,
          verifiedAt: null,
          otpHash: visitorIdentityHash('654321'),
          otpExpiresAt: new Date(Date.now() + 600000),
          otpAttempts: 1,
          series: validSeries,
        });

      await expect(service.verify(verifyDto, '127.0.0.1')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prismaMock.visitorRegistration.update).toHaveBeenCalledWith({
        where: { id: verifyDto.registrationId },
        data: { otpAttempts: { increment: 1 } },
      });
      expect(prismaMock.visitorSession.create).not.toHaveBeenCalled();
    });

    it('comprova e emite sessão para registro legado com OTP correto', async () => {
      prismaMock.visitorRegistration.findUnique
        .mockResolvedValueOnce({ seriesId: 'series-uuid-1' })
        .mockResolvedValueOnce({
          id: verifyDto.registrationId,
          seriesId: 'series-uuid-1',
          identifiedAt: null,
          verifiedAt: null,
          otpHash: visitorIdentityHash(verifyDto.code),
          otpExpiresAt: new Date(Date.now() + 600000),
          otpAttempts: 0,
          series: validSeries,
        });
      prismaMock.visitorSession.create.mockResolvedValue({
        id: 'session-legacy-1',
      });

      const result = await service.verify(verifyDto, '127.0.0.1');

      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('expiresAt');
      const updateCalls = prismaMock.visitorRegistration.update.mock
        .calls as unknown as [
        {
          where: { id: string };
          data: {
            verifiedAt?: unknown;
            otpHash?: unknown;
            otpExpiresAt?: unknown;
            otpAttempts?: unknown;
          };
        },
      ][];
      const verifiedUpdate = updateCalls.find(
        (c) => c[0].data?.verifiedAt !== undefined,
      )?.[0];
      expect(verifiedUpdate).toBeDefined();
      expect(verifiedUpdate?.where.id).toBe(verifyDto.registrationId);
      expect(verifiedUpdate?.data.verifiedAt).toBeInstanceOf(Date);
      expect(verifiedUpdate?.data.otpHash).toBeNull();
      expect(verifiedUpdate?.data.otpExpiresAt).toBeNull();
      expect(prismaMock.visitorSession.create).toHaveBeenCalled();
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

      const participant = await service.participant(
        'visitor-legacy',
        validEvent.id,
      );
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

      await expect(
        service.participant('visitor-1', validEvent.id),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejeita visitante se a edição da série for diferente da do evento', async () => {
      prismaMock.visitorRegistration.findUnique.mockResolvedValue({
        id: 'visitor-1',
        identifiedAt: new Date(),
        seriesId: 'series-uuid-OUTRA',
        series: validSeries,
      });
      prismaMock.event.findUnique.mockResolvedValue(validEvent);

      await expect(
        service.participant('visitor-1', validEvent.id),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
