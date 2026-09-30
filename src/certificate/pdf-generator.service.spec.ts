import { BadRequestException } from '@nestjs/common';
import { PdfGeneratorService } from './pdf-generator.service';
import type { CertificateView } from './dto/view-certificate.dto';

describe('PdfGeneratorService', () => {
  let service: PdfGeneratorService;
  const originalEnv = process.env.CERTIFICATE_VERIFICATION_BASE_URL;

  beforeEach(() => {
    service = new PdfGeneratorService();
    process.env.CERTIFICATE_VERIFICATION_BASE_URL =
      'https://carteirinha.fatecitaquera.edu.br';
  });

  afterEach(() => {
    process.env.CERTIFICATE_VERIFICATION_BASE_URL = originalEnv;
  });

  const baseCert: CertificateView = {
    id: '11111111-1111-4111-8111-111111111111',
    eventId: '22222222-2222-4222-8222-222222222222',
    attendanceId: '33333333-3333-4333-8333-333333333333',
    verificationCode: 'FATEC-EVT-7K3M9Q2X4P6R8T1V',
    payloadSnapshot: {
      studentName: 'Fulano da Silva dos Santos Gonçalves de Oliveira',
      studentRa: '0123456789',
      course: 'Desenvolvimento de Software Multiplataforma',
      eventTitle:
        'Semana de Inovação, Tecnologia & Inteligência Artificial Aplicada 2026',
      eventDate: '2026-10-05',
      workload: '2 horas e 30 minutos',
      speaker: 'Dra. Maria Antonieta dos Anjos Pereira',
      institution: 'FATEC Itaquera - Centro Paula Souza',
    },
    issuedAt: '2026-10-05T21:05:00.000Z',
    revokedAt: null,
  };

  it('rendersSnapshotAndVerificationCode: produces valid PDF buffer with %PDF- header', async () => {
    const buffer = await service.generatePdf(baseCert);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(5000);
    // Assinatura de cabeçalho PDF
    const header = buffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('handlesLongAccentedNamesAndPagination: generates successfully with complex unicode accents', async () => {
    const complexCert: CertificateView = {
      ...baseCert,
      payloadSnapshot: {
        ...baseCert.payloadSnapshot,
        studentName: 'João Victor Conceição da Assunção e Albuquerque Júnior',
        course: 'Análise e Desenvolvimento de Sistemas com Ênfase em Automação',
      },
    };

    const buffer = await service.generatePdf(complexCert);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(5000);
  });

  it('rejectsUnsafeBaseUrl: throws BadRequestException if verification base url is unsafe', async () => {
    process.env.CERTIFICATE_VERIFICATION_BASE_URL = 'javascript:alert(1)';
    await expect(service.generatePdf(baseCert)).rejects.toThrow(
      BadRequestException,
    );

    process.env.CERTIFICATE_VERIFICATION_BASE_URL = 'ftp://ftp.example.com';
    await expect(service.generatePdf(baseCert)).rejects.toThrow(
      BadRequestException,
    );
  });
});
