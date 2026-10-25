import sharp from 'sharp';
import { createRequire } from 'node:module';
import { TechnologyPdfService } from './technology-pdf.service';
import { PrismaService } from '../database/prisma.service';
import { EventStorageService } from '../public-events/event-storage.service';
import { CertificateView } from './dto/view-certificate.dto';
const parse = createRequire(__filename)('pdf-parse') as (
  data: Buffer,
) => Promise<{ text: string; numpages: number }>;

describe('Certificado de ouvinte da Semana', () => {
  let service: TechnologyPdfService;
  beforeAll(async () => {
    const image = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    service = new TechnologyPdfService(
      {
        eventAsset: {
          findUniqueOrThrow: jest.fn(() =>
            Promise.resolve({ storageKey: 'fake' }),
          ),
        },
      } as unknown as PrismaService,
      {
        get: jest.fn(() => Promise.resolve(image)),
      } as unknown as EventStorageService,
    );
  });
  const fixture = (): CertificateView => ({
    id: 'preview',
    eventId: 'e',
    attendanceId: 'a',
    verificationCode: 'DEMO',
    issuedAt: '2026-10-27T23:10:00Z',
    revokedAt: null,
    payloadSnapshot: {
      studentName: 'Pessoa Exemplo',
      studentRa: '',
      course: '',
      eventTitle: 'Tecnologia e dados',
      speaker: 'Alex Exemplo e Maria Exemplo',
      promoter: 'Empresa Exemplo',
      institution: 'Fatec Itaquera',
      eventDate: '2026-10-27',
      startsAt: '2026-10-27T23:30:00Z',
      endsAt: '2026-10-28T00:10:00Z',
      workload: '40 minutos',
      role: 'ATTENDEE',
      template: {
        id: 't',
        version: 2,
        heading: 'CERTIFICADO',
        edition: 'XIII Semana de Tecnologia',
        design: 'TECHNOLOGY_BLUE_2026_DARK',
        wordingVersion: 'LECTURE_LISTENER_2026',
      },
      signers: [
        {
          id: 's',
          name: 'Responsável de demonstração',
          title: 'Coordenador',
          assetId: 'fake',
        },
      ],
    },
  });
  it('inclui ouvinte, palestra, ministrantes, empresa e horário local em uma página', async () => {
    const result = await parse(await service.render(fixture(), true));
    const text = result.text.replace(/\s+/g, ' ');
    expect(result.numpages).toBe(1);
    expect(text).toContain('participou como ouvinte da palestra');
    expect(text).toContain('ministrada por Alex Exemplo e Maria Exemplo');
    expect(text).toContain('promovida por Empresa Exemplo');
    expect(text).toContain('20:30');
    expect(text).toContain('21:10');
    expect(text).toContain('40 minutos');
  });
  it('omite empresa ausente e mantém o certificado de palestrante sem texto de ouvinte', async () => {
    const view = fixture();
    view.payloadSnapshot.promoter = '';
    view.payloadSnapshot.role = 'SPEAKER';
    const result = await parse(await service.render(view, true));
    expect(result.text).not.toContain('promovida por');
    expect(result.text).not.toContain('como ouvinte');
    expect(result.text.replace(/\s+/g, ' ')).toContain(
      'ministrou a palestra intitulada',
    );
  });
  it('preserva a redação antiga para snapshots sem identificador', async () => {
    const view = fixture();
    delete view.payloadSnapshot.template!.wordingVersion;
    const result = await parse(await service.render(view, true));
    expect(result.text).not.toContain('como ouvinte');
    expect(result.text).not.toContain('ministrada por');
  });
});
