import { Injectable, BadRequestException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import type { CertificateView } from './dto/view-certificate.dto';

@Injectable()
export class PdfGeneratorService {
  private getVerificationUrl(code: string): string {
    const rawBaseUrl =
      process.env.CERTIFICATE_VERIFICATION_BASE_URL || 'http://localhost:5173';

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

  public async generatePdf(certificate: CertificateView): Promise<Buffer> {
    const verificationUrl = this.getVerificationUrl(
      certificate.verificationCode,
    );
    const qrBuffer = await QRCode.toBuffer(verificationUrl, {
      type: 'png',
      width: 180,
      margin: 1,
      errorCorrectionLevel: 'M',
    });

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margins: { top: 40, bottom: 40, left: 50, right: 50 },
        info: {
          Title: `Certificado - ${certificate.payloadSnapshot.eventTitle}`,
          Author: certificate.payloadSnapshot.institution,
          Subject: 'Certificado de Participação em Evento Acadêmico',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: unknown) => {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        } else if (chunk) {
          chunks.push(Buffer.from(chunk as Uint8Array));
        }
      });
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      // Borda decorativa institucional
      doc
        .lineWidth(3)
        .strokeColor('#b22222') // Vermelho institucional Fatec
        .rect(30, 25, 782, 545)
        .stroke();

      doc.lineWidth(1).strokeColor('#333333').rect(36, 31, 770, 533).stroke();

      // Cabeçalho Institucional
      doc.moveDown(1);
      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .fillColor('#1a1a1a')
        .text(certificate.payloadSnapshot.institution.toUpperCase(), {
          align: 'center',
        });

      doc.moveDown(1);
      doc
        .fontSize(28)
        .font('Helvetica-Bold')
        .fillColor('#b22222')
        .text('CERTIFICADO DE PARTICIPAÇÃO', {
          align: 'center',
          characterSpacing: 1.5,
        });

      doc.moveDown(1.2);

      // Texto Principal com snapshot
      const snapshot = certificate.payloadSnapshot;
      const [year, month, day] = snapshot.eventDate.split('-');
      const formattedDate = `${day}/${month}/${year}`;

      const textoCertificado =
        `Certificamos que ${snapshot.studentName}, portador(a) do RA ${snapshot.studentRa}, ` +
        `do curso de ${snapshot.course}, participou com êxito do evento "${snapshot.eventTitle}", ` +
        `ministrado por ${snapshot.speaker}, realizado em ${formattedDate}, ` +
        `com carga horária total de ${snapshot.workload}.`;

      doc
        .fontSize(14)
        .font('Helvetica')
        .fillColor('#2d3748')
        .text(textoCertificado, {
          align: 'justify',
          lineGap: 6,
        });

      // Rodapé com QR Code e Código de Verificação
      const qrY = 410;
      doc.image(qrBuffer, 60, qrY, { width: 95, height: 95 });

      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .fillColor('#333333')
        .text('Autenticidade e Verificação:', 170, qrY + 15)
        .font('Helvetica')
        .text(`Código: ${certificate.verificationCode}`, 170, qrY + 32)
        .text(`URL: ${verificationUrl}`, 170, qrY + 48)
        .text(
          `Emitido em: ${new Date(certificate.issuedAt).toLocaleDateString('pt-BR')}`,
          170,
          qrY + 64,
        );

      doc.end();
    });
  }
}
