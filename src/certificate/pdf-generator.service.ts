import { BadRequestException, Injectable } from '@nestjs/common';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import type { CertificateView } from './dto/view-certificate.dto';

const CPS_RED = '#BA1A1A';
const TEXT_PRIMARY = '#202124';
const TEXT_SECONDARY = '#5F6368';
const BORDER_LIGHT = '#D9D9D9';
const PANEL_BACKGROUND = '#F7F7F7';

const CPS_LOGO_PATH = join(
  __dirname,
  'assets',
  'cps_logo_cor.png',
);

const FATEC_LOGO_PATH = join(
  __dirname,
  'assets',
  'fatec_ra_metropolitana_sp_capital_itaquera_cor.png',
);

interface FitTextOptions {
  width: number;
  maxHeight: number;
  maxSize: number;
  minSize: number;
  font?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  lineGap?: number;
}

@Injectable()
export class PdfGeneratorService {
  private getVerificationUrl(code: string): string {
    const rawBaseUrl =
      process.env.CERTIFICATE_VERIFICATION_BASE_URL ||
      'http://localhost:5173';

    try {
      const parsed = new URL(rawBaseUrl);

      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Protocolo inválido');
      }

      if (parsed.username || parsed.password) {
        throw new Error('Credenciais na URL não são permitidas');
      }

      const baseUrl = parsed.origin;

      return `${baseUrl}/certificado/verificar/${encodeURIComponent(code)}`;
    } catch {
      throw new BadRequestException(
        'Configuração insegura da URL de verificação',
      );
    }
  }

  private formatSnapshotDate(value: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

    if (!match) {
      return value;
    }

    return `${match[3]}/${match[2]}/${match[1]}`;
  }

  private fitFontSize(
    doc: PDFKit.PDFDocument,
    text: string,
    options: FitTextOptions,
  ): number {
    const font = options.font ?? 'Helvetica';
    const align = options.align ?? 'center';
    const lineGap = options.lineGap ?? 0;

    for (
      let size = options.maxSize;
      size >= options.minSize;
      size -= 0.5
    ) {
      doc.font(font).fontSize(size);

      const height = doc.heightOfString(text, {
        width: options.width,
        align,
        lineGap,
      });

      if (height <= options.maxHeight) {
        return size;
      }
    }

    return options.minSize;
  }

  private drawMetaItem(
    doc: PDFKit.PDFDocument,
    label: string,
    value: string,
    x: number,
    y: number,
    width: number,
  ): void {
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(TEXT_SECONDARY)
      .text(label.toUpperCase(), x, y, {
        width,
        align: 'center',
        characterSpacing: 0.8,
      });

    const valueFontSize = this.fitFontSize(
      doc,
      value,
      {
        width,
        maxHeight: 27,
        maxSize: 11.5,
        minSize: 9,
        font: 'Helvetica-Bold',
        align: 'center',
        lineGap: 1,
      },
    );

    doc
      .font('Helvetica-Bold')
      .fontSize(valueFontSize)
      .fillColor(TEXT_PRIMARY)
      .text(value, x, y + 15, {
        width,
        height: 30,
        align: 'center',
        lineGap: 1,
      });
  }

  public async generatePdf(
    certificate: CertificateView,
  ): Promise<Buffer> {
    const snapshot = certificate.payloadSnapshot;

    const verificationUrl = this.getVerificationUrl(
      certificate.verificationCode,
    );

    const qrBuffer = await QRCode.toBuffer(
      verificationUrl,
      {
        type: 'png',
        width: 220,
        margin: 1,
        errorCorrectionLevel: 'M',
      },
    );

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',

        margins: {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
        },

        info: {
          Title: `Certificado - ${snapshot.eventTitle}`,
          Author: snapshot.institution,
          Subject:
            'Certificado de Participação em Evento Acadêmico',
        },
      });

      const chunks: Buffer[] = [];

      doc.on('data', (chunk: unknown) => {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        } else if (chunk) {
          chunks.push(
            Buffer.from(chunk as Uint8Array),
          );
        }
      });

      doc.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

      doc.on('error', (err) => {
        reject(err);
      });

      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;

      const contentX = 55;
      const contentWidth =
        pageWidth - contentX * 2;

      /*
       * ==========================================================
       * MOLDURA EXTERNA
       * ==========================================================
       */

      doc
        .lineWidth(2.5)
        .strokeColor(CPS_RED)
        .rect(
          24,
          24,
          pageWidth - 48,
          pageHeight - 48,
        )
        .stroke();

      doc
        .lineWidth(0.7)
        .strokeColor(BORDER_LIGHT)
        .rect(
          31,
          31,
          pageWidth - 62,
          pageHeight - 62,
        )
        .stroke();

      /*
       * Pequenos detalhes decorativos nos cantos.
       */

      const decorationLength = 42;

      doc
        .lineWidth(4)
        .strokeColor(CPS_RED)
        .moveTo(31, 31 + decorationLength)
        .lineTo(31, 31)
        .lineTo(31 + decorationLength, 31)
        .stroke();

      doc
        .moveTo(
          pageWidth - 31 - decorationLength,
          31,
        )
        .lineTo(pageWidth - 31, 31)
        .lineTo(
          pageWidth - 31,
          31 + decorationLength,
        )
        .stroke();

      doc
        .moveTo(
          31,
          pageHeight - 31 - decorationLength,
        )
        .lineTo(31, pageHeight - 31)
        .lineTo(
          31 + decorationLength,
          pageHeight - 31,
        )
        .stroke();

      doc
        .moveTo(
          pageWidth - 31 - decorationLength,
          pageHeight - 31,
        )
        .lineTo(
          pageWidth - 31,
          pageHeight - 31,
        )
        .lineTo(
          pageWidth - 31,
          pageHeight - 31 - decorationLength,
        )
        .stroke();

      /*
       * ==========================================================
       * CABEÇALHO INSTITUCIONAL
       * ==========================================================
       */

      /*
       * Logo FATEC Itaquera.
       */

      doc.image(
        FATEC_LOGO_PATH,
        contentX,
        45,
        {
          fit: [135, 62],
          valign: 'center',
        },
      );

      /*
       * Logo Centro Paula Souza.
       */

      doc.image(
        CPS_LOGO_PATH,
        pageWidth - contentX - 92,
        49,
        {
          fit: [92, 58],
          align: 'right',
          valign: 'center',
        },
      );

      /*
       * Identificação central.
       */

      doc
        .font('Helvetica-Bold')
        .fontSize(10.5)
        .fillColor(TEXT_PRIMARY)
        .text(
          'FACULDADE DE TECNOLOGIA DE ITAQUERA',
          215,
          57,
          {
            width: pageWidth - 430,
            align: 'center',
            characterSpacing: 0.5,
          },
        );

      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(TEXT_SECONDARY)
        .text(
          'Centro Estadual de Educação Tecnológica Paula Souza',
          215,
          77,
          {
            width: pageWidth - 430,
            align: 'center',
          },
        );

      /*
       * Linha abaixo do cabeçalho.
       */

      doc
        .moveTo(contentX, 113)
        .lineTo(
          pageWidth - contentX,
          113,
        )
        .lineWidth(0.8)
        .strokeColor(BORDER_LIGHT)
        .stroke();

      doc
        .moveTo(contentX, 113)
        .lineTo(
          contentX + 115,
          113,
        )
        .lineWidth(2.5)
        .strokeColor(CPS_RED)
        .stroke();

      /*
       * ==========================================================
       * TÍTULO
       * ==========================================================
       */

      doc
        .font('Helvetica-Bold')
        .fontSize(31)
        .fillColor(CPS_RED)
        .text(
          'CERTIFICADO',
          contentX,
          128,
          {
            width: contentWidth,
            align: 'center',
            characterSpacing: 2,
          },
        );

      doc
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .fillColor(TEXT_SECONDARY)
        .text(
          'DE PARTICIPAÇÃO',
          contentX,
          166,
          {
            width: contentWidth,
            align: 'center',
            characterSpacing: 2.6,
          },
        );

      /*
       * ==========================================================
       * ALUNO
       * ==========================================================
       */

      doc
        .font('Helvetica')
        .fontSize(10.5)
        .fillColor(TEXT_SECONDARY)
        .text(
          'Certificamos que',
          contentX,
          196,
          {
            width: contentWidth,
            align: 'center',
          },
        );

      /*
       * Nome do aluno.
       *
       * O tamanho da fonte diminui automaticamente caso o nome
       * seja muito grande.
       */

      const studentNameSize =
        this.fitFontSize(
          doc,
          snapshot.studentName,
          {
            width:
              contentWidth - 90,
            maxHeight: 46,
            maxSize: 25,
            minSize: 17,
            font: 'Helvetica-Bold',
            align: 'center',
            lineGap: 1,
          },
        );

      doc
        .font('Helvetica-Bold')
        .fontSize(studentNameSize)
        .fillColor(TEXT_PRIMARY)
        .text(
          snapshot.studentName,
          contentX + 45,
          215,
          {
            width:
              contentWidth - 90,
            height: 48,
            align: 'center',
            lineGap: 1,
          },
        );

      /*
       * Linha decorativa abaixo do nome.
       */

      doc
        .moveTo(
          pageWidth / 2 - 120,
          263,
        )
        .lineTo(
          pageWidth / 2 + 120,
          263,
        )
        .lineWidth(0.7)
        .strokeColor(BORDER_LIGHT)
        .stroke();

      /*
       * RA + curso.
       */

      const studentInfo =
        `RA ${snapshot.studentRa}  •  ${snapshot.course}`;

      const studentInfoSize =
        this.fitFontSize(
          doc,
          studentInfo,
          {
            width:
              contentWidth - 120,
            maxHeight: 23,
            maxSize: 10,
            minSize: 8,
            font: 'Helvetica',
            align: 'center',
          },
        );

      doc
        .font('Helvetica')
        .fontSize(studentInfoSize)
        .fillColor(TEXT_SECONDARY)
        .text(
          studentInfo,
          contentX + 60,
          271,
          {
            width:
              contentWidth - 120,
            height: 23,
            align: 'center',
          },
        );

      /*
       * ==========================================================
       * EVENTO
       * ==========================================================
       */

      doc
        .font('Helvetica')
        .fontSize(10.5)
        .fillColor(TEXT_SECONDARY)
        .text(
          'participou do evento',
          contentX,
          301,
          {
            width: contentWidth,
            align: 'center',
          },
        );

      /*
       * Título do evento.
       *
       * Também possui ajuste automático para suportar títulos
       * maiores sem sair da página.
       */

      const eventTitleSize =
        this.fitFontSize(
          doc,
          snapshot.eventTitle,
          {
            width:
              contentWidth - 120,
            maxHeight: 50,
            maxSize: 17,
            minSize: 11,
            font: 'Helvetica-Bold',
            align: 'center',
            lineGap: 2,
          },
        );

      doc
        .font('Helvetica-Bold')
        .fontSize(eventTitleSize)
        .fillColor(CPS_RED)
        .text(
          snapshot.eventTitle,
          contentX + 60,
          320,
          {
            width:
              contentWidth - 120,
            height: 52,
            align: 'center',
            lineGap: 2,
          },
        );

      /*
       * Palestrante/responsável.
       */

      const speakerText =
        `Ministrado por ${snapshot.speaker}`;

      const speakerSize =
        this.fitFontSize(
          doc,
          speakerText,
          {
            width:
              contentWidth - 160,
            maxHeight: 22,
            maxSize: 10,
            minSize: 8,
            font: 'Helvetica',
            align: 'center',
          },
        );

      doc
        .font('Helvetica')
        .fontSize(speakerSize)
        .fillColor(TEXT_SECONDARY)
        .text(
          speakerText,
          contentX + 80,
          377,
          {
            width:
              contentWidth - 160,
            height: 22,
            align: 'center',
          },
        );

      /*
       * ==========================================================
       * DATA E CARGA HORÁRIA
       * ==========================================================
       */

      const metaY = 410;

      const metaWidth = 210;
      const metaGap = 24;

      const metaStartX =
        (
          pageWidth -
          (
            metaWidth * 2 +
            metaGap
          )
        ) / 2;

      this.drawMetaItem(
        doc,
        'Data do evento',
        this.formatSnapshotDate(
          snapshot.eventDate,
        ),
        metaStartX,
        metaY,
        metaWidth,
      );

      this.drawMetaItem(
        doc,
        'Carga horária',
        snapshot.workload,
        metaStartX +
          metaWidth +
          metaGap,
        metaY,
        metaWidth,
      );

      /*
       * Separador entre data e carga horária.
       */

      doc
        .moveTo(
          pageWidth / 2,
          metaY + 1,
        )
        .lineTo(
          pageWidth / 2,
          metaY + 42,
        )
        .lineWidth(0.7)
        .strokeColor(BORDER_LIGHT)
        .stroke();

      /*
       * ==========================================================
       * AUTENTICAÇÃO
       * ==========================================================
       */

      const panelX = 50;
      const panelY = 470;

      const panelWidth =
        pageWidth - 100;

      const panelHeight = 82;

      doc
        .roundedRect(
          panelX,
          panelY,
          panelWidth,
          panelHeight,
          8,
        )
        .fillAndStroke(
          PANEL_BACKGROUND,
          BORDER_LIGHT,
        );

      /*
       * QR Code.
       */

      const qrSize = 64;

      doc.image(
        qrBuffer,
        panelX + 12,
        panelY + 9,
        {
          width: qrSize,
          height: qrSize,
        },
      );

      /*
       * Informações de autenticação.
       */

      const verificationX =
        panelX + 91;

      const verificationWidth =
        panelWidth - 108;

      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor(TEXT_PRIMARY)
        .text(
          'VERIFICAÇÃO DE AUTENTICIDADE',
          verificationX,
          panelY + 11,
          {
            width:
              verificationWidth,
            characterSpacing: 0.6,
          },
        );

      doc
        .font('Helvetica')
        .fontSize(8.4)
        .fillColor(TEXT_SECONDARY)
        .text(
          `Código: ${certificate.verificationCode}`,
          verificationX,
          panelY + 29,
          {
            width:
              verificationWidth,
          },
        );

      doc
        .text(
          'Validação pública:',
          verificationX,
          panelY + 44,
          {
            width: 86,
          },
        );

      /*
       * Link clicável.
       */

      doc
        .fillColor(CPS_RED)
        .text(
          verificationUrl,
          verificationX + 86,
          panelY + 44,
          {
            width:
              verificationWidth -
              86,
            link: verificationUrl,
            underline: false,
          },
        );

      /*
       * Data de emissão.
       */

      doc
        .fillColor(TEXT_SECONDARY)
        .text(
          `Emitido em ${new Date(
            certificate.issuedAt,
          ).toLocaleDateString(
            'pt-BR',
          )}`,
          verificationX,
          panelY + 60,
          {
            width:
              verificationWidth,
          },
        );

      doc.end();
    });
  }
}