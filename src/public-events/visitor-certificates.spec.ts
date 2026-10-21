import {
  BadRequestException,
  ConflictException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  VisitorService,
  tokenHash,
  visitorIdentityHash,
} from './visitor.service';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';

describe('Recuperação de certificados por CPF', () => {
  const cpf = '52998224725';
  const cpfHash = visitorIdentityHash(`cpf:${cpf}`);
  const visitor = {
    id: 'visitor-1',
    cpfHash,
    seriesId: 'series-1',
    identifiedAt: new Date(),
    series: {
      purgedAt: null,
      retentionAt: new Date(Date.now() + 30 * 86400000),
    },
  };
  const prisma = {
    eventRateLimit: { upsert: jest.fn() },
    visitorRegistration: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    visitorSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const service = new VisitorService(
    prisma as unknown as PrismaService,
    {} as MailService,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.eventRateLimit.upsert.mockResolvedValue({ count: 1 });
    prisma.visitorRegistration.findFirst.mockResolvedValue(visitor);
    prisma.visitorRegistration.findMany.mockResolvedValue([
      { id: visitor.id },
      { id: 'visitor-2' },
    ]);
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
    );
  });

  it('recupera por hash, limita tentativas e separa a sessão de certificados da presença', async () => {
    const result = await service.recoverCertificates(
      '529.982.247-25',
      'test-ip',
    );
    expect(prisma.visitorRegistration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          cpfHash,
          series: {
            purgedAt: null,
            retentionAt: { gt: expect.any(Date) as Date },
          },
        },
      }),
    );
    expect(prisma.visitorSession.create).toHaveBeenCalledWith({
      data: {
        visitorId: visitor.id,
        tokenHash: tokenHash(`certificates:${result.token}`),
        expiresAt: result.expiresAt,
      },
    });
    expect(prisma.eventRateLimit.upsert).toHaveBeenCalledTimes(2);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 3600000,
    );
    prisma.visitorSession.findUnique.mockImplementation(
      ({ where }: { where: { tokenHash: string } }) =>
        where.tokenHash === tokenHash(`certificates:${result.token}`)
          ? { visitor, expiresAt: result.expiresAt }
          : null,
    );
    await expect(service.session(result.token)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(
      service.certificateVisitorIds(undefined, result.token),
    ).resolves.toEqual(['visitor-1', 'visitor-2']);
    expect(prisma.visitorRegistration.findMany).toHaveBeenCalledWith({
      where: {
        cpfHash,
        series: {
          purgedAt: null,
          retentionAt: { gt: expect.any(Date) as Date },
        },
      },
      select: { id: true },
    });
  });

  it('rejeita CPF inválido antes de consultar cadastros', async () => {
    await expect(
      service.recoverCertificates('11111111111', 'test-ip'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.visitorRegistration.findFirst).not.toHaveBeenCalled();
    expect(prisma.visitorSession.create).not.toHaveBeenCalled();
  });

  it('CPF desconhecido não cria acesso', async () => {
    prisma.visitorRegistration.findFirst.mockResolvedValue(null);
    await expect(service.recoverCertificates(cpf, 'test-ip')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.visitorSession.create).not.toHaveBeenCalled();
  });

  it('interrompe recuperação quando o limite é ultrapassado', async () => {
    prisma.eventRateLimit.upsert.mockResolvedValueOnce({ count: 301 });
    await expect(service.recoverCertificates(cpf, 'test-ip')).rejects.toThrow(
      HttpException,
    );
    expect(prisma.visitorRegistration.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    { expiresAt: new Date(0), visitor },
    {
      expiresAt: new Date(Date.now() + 3600000),
      visitor: {
        ...visitor,
        series: { ...visitor.series, purgedAt: new Date() },
      },
    },
    {
      expiresAt: new Date(Date.now() + 3600000),
      visitor: {
        ...visitor,
        series: { ...visitor.series, retentionAt: new Date(0) },
      },
    },
  ])(
    'sessão expirada ou dados expurgados não liberam certificados',
    async (row) => {
      prisma.visitorSession.findUnique.mockResolvedValue(row);
      await expect(
        service.certificateVisitorIds(undefined, 'a'.repeat(43)),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.visitorRegistration.findMany).not.toHaveBeenCalled();
    },
  );

  it('preserva o acesso existente da sessão de presença', async () => {
    prisma.visitorSession.findUnique.mockResolvedValue({
      visitor,
      expiresAt: new Date(Date.now() + 3600000),
    });
    await expect(
      service.certificateVisitorIds('a'.repeat(43)),
    ).resolves.toEqual([visitor.id]);
  });

  it('vincula CPF de cadastro antigo sem alterar o histórico', async () => {
    prisma.visitorSession.findUnique.mockResolvedValue({
      visitor: { ...visitor, cpfHash: null },
      expiresAt: new Date(Date.now() + 3600000),
    });
    prisma.visitorRegistration.findUnique.mockResolvedValue({
      ...visitor,
      cpfHash: null,
    });
    prisma.visitorRegistration.findFirst.mockResolvedValue(null);
    await expect(service.bindCpf('a'.repeat(43), cpf)).resolves.toEqual({
      success: true,
    });
    expect(prisma.visitorRegistration.update).toHaveBeenCalledWith({
      where: { id: visitor.id },
      data: { cpfHash },
    });
  });

  it('não troca um CPF já vinculado nem apropria CPF de outro cadastro', async () => {
    prisma.visitorSession.findUnique.mockResolvedValue({
      visitor,
      expiresAt: new Date(Date.now() + 3600000),
    });
    prisma.visitorRegistration.findUnique.mockResolvedValue({
      ...visitor,
      cpfHash: 'other-hash',
    });
    await expect(service.bindCpf('a'.repeat(43), cpf)).rejects.toThrow(
      ConflictException,
    );
    prisma.visitorRegistration.findUnique.mockResolvedValue({
      ...visitor,
      cpfHash: null,
    });
    prisma.visitorRegistration.findFirst.mockResolvedValue({
      id: 'different-visitor',
    });
    await expect(service.bindCpf('a'.repeat(43), cpf)).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.visitorRegistration.update).not.toHaveBeenCalled();
  });
});
