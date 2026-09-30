/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { ConflictException } from '@nestjs/common';
import { CertificateService } from './certificate.service';
import { isValidVerificationCode } from './verification-code';
import { Prisma } from '@prisma/client';

describe('CertificateService Unit Tests', () => {
  let service: CertificateService;
  let prismaMock: any;
  let pdfGeneratorMock: any;

  beforeEach(() => {
    prismaMock = {
      $transaction: jest.fn((cb) => cb(prismaMock)),
      attendance: {
        findUnique: jest.fn(),
      },
      certificate: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
      student: {
        findUnique: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };

    pdfGeneratorMock = {
      generatePdf: jest.fn(),
    };

    service = new CertificateService(prismaMock, pdfGeneratorMock);
  });

  it('rejectsUnconfirmedAttendance: does not issue if attendance is not CONFIRMED or checkOutAt is missing', async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({
      id: 'att-1',
      status: 'CHECKED_IN',
      checkOutAt: null,
      event: { certificateEnabled: true, status: 'SCHEDULED' },
    });

    const result = await service.issueCertificate('att-1', prismaMock);
    expect(result).toBeNull();
    expect(prismaMock.certificate.create).not.toHaveBeenCalled();
  });

  it('disabledEventDoesNotIssue: does not issue if event.certificateEnabled is false or event is CANCELLED', async () => {
    // Caso 1: desabilitado
    prismaMock.attendance.findUnique.mockResolvedValueOnce({
      id: 'att-1',
      status: 'CONFIRMED',
      checkOutAt: new Date(),
      event: { certificateEnabled: false, status: 'IN_PROGRESS' },
    });
    let result = await service.issueCertificate('att-1', prismaMock);
    expect(result).toBeNull();

    // Caso 2: cancelado
    prismaMock.attendance.findUnique.mockResolvedValueOnce({
      id: 'att-1',
      status: 'CONFIRMED',
      checkOutAt: new Date(),
      event: { certificateEnabled: true, status: 'CANCELLED' },
    });
    result = await service.issueCertificate('att-1', prismaMock);
    expect(result).toBeNull();
  });

  it('returnsExistingWithoutChangingSnapshot: returns already existing certificate by attendanceId or ra', async () => {
    const existingCert = {
      id: 'cert-1',
      verificationCode: 'FATEC-EVT-0123456789ABCDEF',
      payloadSnapshot: { studentName: 'Nome Original' },
    };

    prismaMock.attendance.findUnique.mockResolvedValue({
      id: 'att-1',
      status: 'CONFIRMED',
      checkOutAt: new Date(),
      eventId: 'evt-1',
      studentRa: '0123456789',
      studentAccountId: 'acc-1',
      event: { certificateEnabled: true, status: 'COMPLETED' },
    });
    prismaMock.certificate.findUnique.mockResolvedValueOnce(existingCert);

    const result = await service.issueCertificate('att-1', prismaMock);
    expect(result).toEqual(existingCert);
    expect(prismaMock.certificate.create).not.toHaveBeenCalled();
  });

  it('snapshotsHistoricalNameCourseAndBrazilDate: preserves historical data from Attendance and Event', async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({
      id: 'att-1',
      eventId: 'evt-1',
      studentRa: '0123456789',
      studentName: 'Nome Histórico do Aluno',
      studentCourse: 'DSM',
      studentAccountId: 'acc-1',
      status: 'CONFIRMED',
      checkInAt: new Date('2026-10-05T19:00:00.000Z'),
      checkOutAt: new Date('2026-10-05T21:00:00.000Z'),
      event: {
        id: 'evt-1',
        title: 'Palestra de Arquitetura',
        speaker: 'Prof. Exemplo',
        startsAt: new Date('2026-10-05T19:00:00.000Z'),
        workloadMinutes: 90,
        certificateEnabled: true,
        status: 'COMPLETED',
      },
    });

    prismaMock.certificate.findUnique.mockResolvedValue(null);
    prismaMock.student.findUnique.mockResolvedValue({
      ra: '0123456789',
      accountId: 'acc-1',
    });

    prismaMock.certificate.create.mockImplementation((args: any) =>
      Promise.resolve({ id: 'new-cert-1', ...args.data }),
    );

    const created = await service.issueCertificate('att-1', prismaMock);
    expect(created).toBeDefined();
    expect(created.studentRefRa).toBe('0123456789');
    expect(created.payloadSnapshot).toEqual({
      studentName: 'Nome Histórico do Aluno',
      studentRa: '0123456789',
      course: 'DSM',
      eventTitle: 'Palestra de Arquitetura',
      eventDate: '2026-10-05',
      workload: '1 hora e 30 minutos',
      speaker: 'Prof. Exemplo',
      institution: 'FATEC Itaquera - Centro Paula Souza',
    });
  });

  it('codeHasSixteenCryptoCharacters: canonical verificationCode matches 80-bit format', async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({
      id: 'att-1',
      eventId: 'evt-1',
      studentRa: '0123456789',
      studentName: 'Aluno Teste',
      studentCourse: 'DSM',
      studentAccountId: 'acc-1',
      status: 'CONFIRMED',
      checkOutAt: new Date(),
      event: {
        id: 'evt-1',
        title: 'Evento',
        speaker: 'Palestrante',
        startsAt: new Date(),
        workloadMinutes: 60,
        certificateEnabled: true,
      },
    });

    prismaMock.certificate.findUnique.mockResolvedValue(null);
    prismaMock.student.findUnique.mockResolvedValue({
      ra: '0123456789',
      accountId: 'acc-1',
    });
    prismaMock.certificate.create.mockImplementation((args: any) =>
      Promise.resolve({ id: 'c1', ...args.data }),
    );

    const result = await service.issueCertificate('att-1', prismaMock);
    expect(result.verificationCode).toBeDefined();
    expect(isValidVerificationCode(result.verificationCode)).toBe(true);
    expect(result.verificationCode).toMatch(
      /^FATEC-EVT-[0-9A-HJKMNP-TV-Z]{16}$/,
    );
  });

  it('retriesCodeCollisionWithoutMutatingExistingCertificate: retries when verificationCode collides', async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({
      id: 'att-1',
      eventId: 'evt-1',
      studentRa: '0123456789',
      studentName: 'Aluno Teste',
      studentCourse: 'DSM',
      studentAccountId: 'acc-1',
      status: 'CONFIRMED',
      checkOutAt: new Date(),
      event: {
        id: 'evt-1',
        title: 'Evento',
        speaker: 'Palestrante',
        startsAt: new Date(),
        workloadMinutes: 60,
        certificateEnabled: true,
      },
    });
    prismaMock.certificate.findUnique.mockResolvedValue(null);

    const p2002CodeError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on verificationCode',
      {
        code: 'P2002',
        clientVersion: '7.1.0',
        meta: { target: ['verificationCode'] },
      },
    );

    // 1ª tentativa falha por colisão de código, 2ª passa
    prismaMock.certificate.create
      .mockRejectedValueOnce(p2002CodeError)
      .mockResolvedValueOnce({
        id: 'cert-ok',
        verificationCode: 'FATEC-EVT-NEWCODE12345678',
      });

    const result = await service.issueCertificate('att-1', prismaMock);
    expect(result.id).toBe('cert-ok');
    expect(prismaMock.certificate.create).toHaveBeenCalledTimes(2);
  });

  it('rejectsHistoryIdentityConflict: throws ConflictException if concurrent certificate belongs to different account', async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({
      id: 'att-1',
      eventId: 'evt-1',
      studentRa: '0123456789',
      studentName: 'Aluno Teste',
      studentCourse: 'DSM',
      studentAccountId: 'acc-origin',
      status: 'CONFIRMED',
      checkOutAt: new Date(),
      event: {
        id: 'evt-1',
        title: 'Evento',
        speaker: 'Palestrante',
        startsAt: new Date(),
        workloadMinutes: 60,
        certificateEnabled: true,
      },
    });
    prismaMock.certificate.findUnique.mockResolvedValue(null);

    const p2002RaError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on eventId_studentRa',
      {
        code: 'P2002',
        clientVersion: '7.1.0',
        meta: { target: ['eventId_studentRa'] },
      },
    );
    prismaMock.certificate.create.mockRejectedValueOnce(p2002RaError);

    // Certificado encontrado pertence a OUTRA conta (conflito de identidade de histórico)
    prismaMock.certificate.findFirst.mockResolvedValueOnce({
      id: 'diff-cert',
      studentAccountId: 'acc-different',
    });

    await expect(service.issueCertificate('att-1', prismaMock)).rejects.toThrow(
      ConflictException,
    );
  });
});
