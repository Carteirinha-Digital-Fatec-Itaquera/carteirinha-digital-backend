import { Test, TestingModule } from '@nestjs/testing';
import { EventJobsService } from './event-jobs.service';
import { PrismaService } from '../database/prisma.service';
import { PdfGeneratorService } from '../certificate/pdf-generator.service';
import { EventStorageService } from './event-storage.service';
import { EventOperationsService } from './event-operations.service';
import { MailService } from '../mail/mail.service';

const matchAnyString = expect.any(String) as unknown as string;
const matchString = (re: RegExp) =>
  expect.stringMatching(re) as unknown as string;
const matchObject = (val: Record<string, unknown>) =>
  expect.objectContaining(val) as unknown as Record<string, unknown>;

describe('EventJobsService', () => {
  let service: EventJobsService;
  let prisma: {
    certificateArtifact: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    certificate: {
      findUniqueOrThrow: jest.Mock;
    };
    student: {
      findUnique: jest.Mock;
    };
    eventSeries: {
      findMany: jest.Mock;
    };
    eventCheckpoint: {
      findMany: jest.Mock;
    };
    presenceChallenge: {
      deleteMany: jest.Mock;
    };
    eventRateLimit: {
      deleteMany: jest.Mock;
    };
    visitorSession: {
      deleteMany: jest.Mock;
    };
    eventAsset: {
      findMany: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let mail: {
    sendCertificateNotification: jest.Mock;
    sendVisitorCertificate: jest.Mock;
  };
  let pdf: {
    generatePdf: jest.Mock;
  };
  let storage: {
    put: jest.Mock;
    remove: jest.Mock;
  };
  let operations: {
    purge: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      certificateArtifact: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      certificate: {
        findUniqueOrThrow: jest.fn(),
      },
      student: {
        findUnique: jest.fn(),
      },
      eventSeries: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      eventCheckpoint: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      presenceChallenge: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      eventRateLimit: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      visitorSession: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      eventAsset: {
        findMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(),
    };

    mail = {
      sendCertificateNotification: jest.fn().mockResolvedValue(undefined),
      sendVisitorCertificate: jest.fn().mockResolvedValue(undefined),
    };

    pdf = {
      generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
    };

    storage = {
      put: jest
        .fn()
        .mockResolvedValue({ storageKey: 'test.pdf', sha256: 'abc' }),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    operations = {
      purge: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventJobsService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        { provide: PdfGeneratorService, useValue: pdf },
        { provide: EventStorageService, useValue: storage },
        { provide: EventOperationsService, useValue: operations },
      ],
    }).compile();

    service = module.get<EventJobsService>(EventJobsService);
  });

  it('notifica aluno ativo por email com link seguro para /certificados e atualiza deliveryState para SENT', async () => {
    const artifactId = 'art-1';
    const certId = 'cert-1';
    const studentAccountId = 'acc-student-123';

    prisma.certificateArtifact.findUniqueOrThrow.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId,
        revokedAt: null,
        event: { status: 'IN_PROGRESS', title: 'Palestra de Inovação' },
        participant: null,
      },
    });

    prisma.certificateArtifact.findFirst.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId,
        revokedAt: null,
        event: { status: 'IN_PROGRESS', title: 'Palestra de Inovação' },
        participant: null,
      },
    });

    prisma.certificate.findUniqueOrThrow.mockResolvedValue({
      id: certId,
      revokedAt: null,
    });

    prisma.student.findUnique.mockResolvedValue({
      ra: '123456',
      accountId: studentAccountId,
      name: 'João Estudante',
      email: 'joao@fatec.sp.gov.br',
      status: 'Ativo',
    });

    await service.process(artifactId);

    expect(prisma.student.findUnique).toHaveBeenCalledWith({
      where: { accountId: studentAccountId },
      select: { ra: true, name: true, email: true, status: true },
    });

    expect(mail.sendCertificateNotification).toHaveBeenCalledWith(
      matchObject({
        email: 'joao@fatec.sp.gov.br',
        recipientName: 'João Estudante',
        eventTitle: 'Palestra de Inovação',
        accessUrl: matchString(/\/certificados$/),
        profile: 'ALUNO',
      }),
    );

    expect(prisma.certificateArtifact.updateMany).toHaveBeenCalledWith({
      where: {
        id: artifactId,
        leaseToken: matchAnyString,
        deliveryState: 'DISPATCHING',
      },
      data: { deliveryState: 'SENT' },
    });
  });

  it('notifica visitante ativo com link seguro para /visitantes/certificados se dentro do periodo de retencao', async () => {
    const artifactId = 'art-2';
    const certId = 'cert-2';

    const futureDate = new Date(Date.now() + 86400000 * 30);
    const mockVisitor = {
      name: 'Maria Visitante',
      email: 'maria@gmail.com',
      series: { purgedAt: null, retentionAt: futureDate },
    };

    prisma.certificateArtifact.findUniqueOrThrow.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId: null,
        revokedAt: null,
        event: { status: 'COMPLETED', title: 'Semana de Tecnologia' },
        participant: { visitor: mockVisitor },
      },
    });

    prisma.certificateArtifact.findFirst.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId: null,
        revokedAt: null,
        event: { status: 'COMPLETED', title: 'Semana de Tecnologia' },
        participant: { visitor: mockVisitor },
      },
    });

    prisma.certificate.findUniqueOrThrow.mockResolvedValue({
      id: certId,
      revokedAt: null,
    });

    await service.process(artifactId);

    expect(mail.sendCertificateNotification).toHaveBeenCalledWith(
      matchObject({
        email: 'maria@gmail.com',
        recipientName: 'Maria Visitante',
        eventTitle: 'Semana de Tecnologia',
        accessUrl: matchString(/\/visitantes\/certificados$/),
        profile: 'VISITANTE',
      }),
    );

    expect(prisma.certificateArtifact.updateMany).toHaveBeenCalledWith({
      where: {
        id: artifactId,
        leaseToken: matchAnyString,
        deliveryState: 'DISPATCHING',
      },
      data: { deliveryState: 'SENT' },
    });
  });

  it('marca deliveryState como EXPIRED se retencao do visitante estiver vencida ou serie purgada', async () => {
    const artifactId = 'art-3';
    const certId = 'cert-3';

    const pastDate = new Date(Date.now() - 86400000);
    const mockExpiredVisitor = {
      name: 'Visitante Expirado',
      email: 'expirado@gmail.com',
      series: { purgedAt: null, retentionAt: pastDate },
    };

    prisma.certificateArtifact.findUniqueOrThrow.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId: null,
        revokedAt: null,
        event: { status: 'COMPLETED', title: 'Workshop Antigo' },
        participant: { visitor: mockExpiredVisitor },
      },
    });

    prisma.certificateArtifact.findFirst.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId: null,
        revokedAt: null,
        event: { status: 'COMPLETED', title: 'Workshop Antigo' },
        participant: { visitor: mockExpiredVisitor },
      },
    });

    prisma.certificate.findUniqueOrThrow.mockResolvedValue({
      id: certId,
      revokedAt: null,
    });

    await service.process(artifactId);

    expect(mail.sendCertificateNotification).not.toHaveBeenCalled();
    expect(prisma.certificateArtifact.updateMany).toHaveBeenCalledWith({
      where: { id: artifactId, leaseToken: matchAnyString },
      data: { deliveryState: 'EXPIRED', leaseUntil: null, leaseToken: null },
    });
  });

  it('marca deliveryState como EXPIRED se o certificado tiver sido revogado', async () => {
    const artifactId = 'art-4';
    const certId = 'cert-4';

    prisma.certificateArtifact.findUniqueOrThrow.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId: 'acc-1',
        revokedAt: new Date(),
        event: { status: 'COMPLETED', title: 'Evento Revogado' },
        participant: null,
      },
    });

    await service.process(artifactId);

    expect(mail.sendCertificateNotification).not.toHaveBeenCalled();
    expect(prisma.certificateArtifact.updateMany).toHaveBeenCalledWith({
      where: { id: artifactId, leaseToken: matchAnyString },
      data: {
        state: 'REVOKED',
        deliveryState: 'EXPIRED',
        leaseUntil: null,
        leaseToken: null,
      },
    });
  });

  it('marca deliveryState como FAILED se conta de aluno nao existir ou nao tiver email', async () => {
    const artifactId = 'art-5';
    const certId = 'cert-5';
    const studentAccountId = 'inexistente-123';

    prisma.certificateArtifact.findUniqueOrThrow.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId,
        revokedAt: null,
        event: { status: 'IN_PROGRESS', title: 'Palestra' },
        participant: null,
      },
    });

    prisma.certificateArtifact.findFirst.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId,
        revokedAt: null,
        event: { status: 'IN_PROGRESS', title: 'Palestra' },
        participant: null,
      },
    });

    prisma.certificate.findUniqueOrThrow.mockResolvedValue({
      id: certId,
      revokedAt: null,
    });

    prisma.student.findUnique.mockResolvedValue(null);

    await service.process(artifactId);

    expect(mail.sendCertificateNotification).not.toHaveBeenCalled();
    expect(prisma.certificateArtifact.updateMany).toHaveBeenCalledWith({
      where: { id: artifactId, leaseToken: matchAnyString },
      data: { deliveryState: 'FAILED', leaseUntil: null, leaseToken: null },
    });
  });

  it('incrementa deliveryAttempts e agenda backoff exponencial quando o envio do Brevo falha', async () => {
    const artifactId = 'art-6';
    const certId = 'cert-6';
    const studentAccountId = 'acc-retry';

    prisma.certificateArtifact.findUniqueOrThrow.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 1,
      attempts: 0,
      certificate: {
        id: certId,
        studentAccountId,
        revokedAt: null,
        event: { status: 'IN_PROGRESS', title: 'Palestra Falha' },
        participant: null,
      },
    });

    prisma.certificateArtifact.findFirst.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 1,
      attempts: 0,
      certificate: {
        id: certId,
        studentAccountId,
        revokedAt: null,
        event: { status: 'IN_PROGRESS', title: 'Palestra Falha' },
        participant: null,
      },
    });

    prisma.certificate.findUniqueOrThrow.mockResolvedValue({
      id: certId,
      revokedAt: null,
    });

    prisma.student.findUnique.mockResolvedValue({
      ra: '777888',
      accountId: studentAccountId,
      name: 'Aluno Teste',
      email: 'teste@fatec.sp.gov.br',
      status: 'Ativo',
    });

    mail.sendCertificateNotification.mockRejectedValue(
      new Error('Brevo connection timeout'),
    );

    prisma.certificateArtifact.findUnique.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      attempts: 0,
      deliveryAttempts: 1,
      deliveryState: 'AMBIGUOUS',
    });

    await service.process(artifactId);

    expect(prisma.certificateArtifact.updateMany).toHaveBeenCalledWith({
      where: { id: artifactId, leaseToken: matchAnyString },
      data: {
        deliveryState: 'AMBIGUOUS',
        leaseUntil: null,
        leaseToken: null,
      },
    });
  });

  it('rejeita e marca FAILED se o aluno estiver com status INATIVO ou trancado', async () => {
    const artifactId = 'art-inactive';
    const certId = 'cert-inactive';
    const studentAccountId = 'acc-inactive';

    prisma.certificateArtifact.findUniqueOrThrow.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId,
        revokedAt: null,
        event: { status: 'COMPLETED', title: 'Atividade' },
        participant: null,
      },
    });

    prisma.certificateArtifact.findFirst.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId,
        revokedAt: null,
        event: { status: 'COMPLETED', title: 'Atividade' },
        participant: null,
      },
    });

    prisma.certificate.findUniqueOrThrow.mockResolvedValue({
      id: certId,
      revokedAt: null,
    });

    prisma.student.findUnique.mockResolvedValue({
      ra: '123456',
      accountId: studentAccountId,
      name: 'Aluno Inativo',
      email: 'inativo@fatec.sp.gov.br',
      status: 'INATIVO',
    });

    await service.process(artifactId);

    expect(mail.sendCertificateNotification).not.toHaveBeenCalled();
    expect(prisma.certificateArtifact.updateMany).toHaveBeenCalledWith({
      where: { id: artifactId, leaseToken: matchAnyString },
      data: { deliveryState: 'FAILED', leaseUntil: null, leaseToken: null },
    });
  });

  it('aceita aluno com status Ativo ou Em curso', async () => {
    const artifactId = 'art-ativo';
    const certId = 'cert-ativo';
    const studentAccountId = 'acc-ativo';

    prisma.certificateArtifact.findUniqueOrThrow.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId,
        revokedAt: null,
        event: { status: 'COMPLETED', title: 'Atividade Ativo' },
        participant: null,
      },
    });

    prisma.certificateArtifact.findFirst.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId,
        revokedAt: null,
        event: { status: 'COMPLETED', title: 'Atividade Ativo' },
        participant: null,
      },
    });

    prisma.certificate.findUniqueOrThrow.mockResolvedValue({
      id: certId,
      revokedAt: null,
    });

    prisma.student.findUnique.mockResolvedValue({
      ra: '123456',
      accountId: studentAccountId,
      name: 'Aluno Em Curso',
      email: 'emcurso@fatec.sp.gov.br',
      status: 'Em curso',
    });

    await service.process(artifactId);

    expect(mail.sendCertificateNotification).toHaveBeenCalledTimes(1);
    expect(prisma.certificateArtifact.updateMany).toHaveBeenCalledWith({
      where: {
        id: artifactId,
        leaseToken: matchAnyString,
        deliveryState: 'DISPATCHING',
      },
      data: { deliveryState: 'SENT' },
    });
  });

  it('reconcilia status para SENT quando aceite remoto sucede mas gravacao local lanca erro', async () => {
    const artifactId = 'art-reconcile';
    const certId = 'cert-reconcile';
    const studentAccountId = 'acc-reconcile';

    prisma.certificateArtifact.findUniqueOrThrow.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId,
        revokedAt: null,
        event: { status: 'COMPLETED', title: 'Atividade Reconciliada' },
        participant: null,
      },
    });

    prisma.certificateArtifact.findFirst.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId,
        revokedAt: null,
        event: { status: 'COMPLETED', title: 'Atividade Reconciliada' },
        participant: null,
      },
    });

    prisma.certificate.findUniqueOrThrow.mockResolvedValue({
      id: certId,
      revokedAt: null,
    });

    prisma.student.findUnique.mockResolvedValue({
      ra: '123456',
      accountId: studentAccountId,
      name: 'Aluno Teste',
      email: 'teste@fatec.sp.gov.br',
      status: 'Ativo',
    });

    // updateMany falha na primeira tentativa de gravar SENT após aceite, mas sucede na reconciliação
    let failOnce = true;
    prisma.certificateArtifact.updateMany.mockImplementation(
      (args: { data?: { deliveryState?: string } }) => {
        if (args.data?.deliveryState === 'SENT' && failOnce) {
          failOnce = false;
          throw new Error('Falha simulada de persistência pós-aceite');
        }
        return Promise.resolve({ count: 1 });
      },
    );

    await service.process(artifactId);

    expect(mail.sendCertificateNotification).toHaveBeenCalledTimes(1);
    // Deve ter chamado a reconciliação segura protegida por leaseToken
    expect(prisma.certificateArtifact.updateMany).toHaveBeenCalledWith({
      where: {
        id: artifactId,
        leaseToken: matchAnyString,
        deliveryState: 'DISPATCHING',
      },
      data: { deliveryState: 'SENT', leaseUntil: null, leaseToken: null },
    });
  });

  it('rejeita e marca FAILED para aluno com status MATRICULADO sem disparar e-mail', async () => {
    const artifactId = 'art-matriculado';
    const certId = 'cert-matriculado';
    const studentAccountId = 'acc-matriculado';

    prisma.certificateArtifact.findUniqueOrThrow.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId,
        revokedAt: null,
        event: { status: 'COMPLETED', title: 'Atividade' },
        participant: null,
      },
    });

    prisma.certificateArtifact.findFirst.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId,
        revokedAt: null,
        event: { status: 'COMPLETED', title: 'Atividade' },
        participant: null,
      },
    });

    prisma.certificate.findUniqueOrThrow.mockResolvedValue({
      id: certId,
      revokedAt: null,
    });

    prisma.student.findUnique.mockResolvedValue({
      ra: '123456',
      accountId: studentAccountId,
      name: 'Aluno Matriculado',
      email: 'matriculado@fatec.sp.gov.br',
      status: 'MATRICULADO',
    });

    await service.process(artifactId);

    expect(mail.sendCertificateNotification).not.toHaveBeenCalled();
    expect(prisma.certificateArtifact.updateMany).toHaveBeenCalledWith({
      where: { id: artifactId, leaseToken: matchAnyString },
      data: { deliveryState: 'FAILED', leaseUntil: null, leaseToken: null },
    });
  });

  it('marca AMBIGUOUS e nao reenvia se encontrar job em DISPATCHING apos expiracao de lease', async () => {
    const artifactId = 'art-dispatching';
    const certId = 'cert-dispatching';
    const studentAccountId = 'acc-dispatching';

    prisma.certificateArtifact.findUniqueOrThrow.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'DISPATCHING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId,
        revokedAt: null,
        event: { status: 'COMPLETED', title: 'Atividade' },
        participant: null,
      },
    });

    prisma.certificateArtifact.findFirst.mockResolvedValue({
      id: artifactId,
      state: 'READY',
      deliveryState: 'DISPATCHING',
      deliveryAttempts: 0,
      certificate: {
        id: certId,
        studentAccountId,
        revokedAt: null,
        event: { status: 'COMPLETED', title: 'Atividade' },
        participant: null,
      },
    });

    await service.process(artifactId);

    expect(mail.sendCertificateNotification).not.toHaveBeenCalled();
    expect(prisma.certificateArtifact.updateMany).toHaveBeenCalledWith({
      where: { id: artifactId, leaseToken: matchAnyString },
      data: { deliveryState: 'AMBIGUOUS', leaseUntil: null, leaseToken: null },
    });
  });
});
