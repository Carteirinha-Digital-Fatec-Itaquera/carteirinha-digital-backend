import { BadRequestException, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { PrismaService } from '../database/prisma.service';
import { EventStorageService } from '../public-events/event-storage.service';
import type { CertificateView } from './dto/view-certificate.dto';
import { join } from 'node:path';

@Injectable()
export class TechnologyPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: EventStorageService,
  ) {}
  async render(view: CertificateView, preview = false): Promise<Buffer> {
    const snapshot = view.payloadSnapshot;
    const config = snapshot.template;
    const isCampaign = config?.design === 'TECHNOLOGY_BLUE_2026';
    if (!config || !snapshot.signers?.length)
      throw new BadRequestException(
        'Modelo requer arte limpa e assinaturas autorizadas.',
      );
    const background = config.backgroundAssetId
      ? await this.prisma.eventAsset.findUniqueOrThrow({
          where: { id: config.backgroundAssetId },
        })
      : null;
    const image = background
      ? await this.storage.get(background.storageKey)
      : null;
    const signatures = await Promise.all(
      snapshot.signers.map(async (signer) => {
        const asset = await this.prisma.eventAsset.findUniqueOrThrow({
          where: { id: signer.assetId },
        });
        return { ...signer, image: await this.storage.get(asset.storageKey) };
      }),
    );
    const base = new URL(
      process.env.CERTIFICATE_VERIFICATION_BASE_URL ||
        process.env.STUDENT_APP_URL ||
        'https://carteirinha-digital-front-end-aluno.vercel.app',
    );
    if (
      !['https:', 'http:'].includes(base.protocol) ||
      base.username ||
      base.password
    )
      throw new BadRequestException('URL de verificação inválida.');
    const url = `${base.origin}/certificado/verificar/${encodeURIComponent(view.verificationCode)}`;
    const qr = preview
      ? null
      : await QRCode.toBuffer(url, { width: 160, margin: 2 });
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: [841.92, 595.32],
        margin: 0,
        info: {
          Title: `Certificado - ${snapshot.eventTitle}`,
          Author: snapshot.institution,
          CreationDate: new Date(view.issuedAt),
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Uint8Array) => chunks.push(Buffer.from(chunk)));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      try {
        // Arte limpa preserva logos, moldura e ilustrações do PDF aprovado.
        if (image) doc.image(image, 0, 0, { width: 841.92, height: 595.32 });
        else if (config.design === 'TECHNOLOGY_BLUE_2026')
          this.drawBlueTechnologyLayout(doc);
        else this.drawReferenceLayout(doc, config.edition);
        doc
          .fillColor(isCampaign ? '#FF9900' : '#000000')
          .font('Helvetica-BoldOblique')
          .fontSize(
            this.fit(
              doc,
              config.heading,
              712,
              45,
              25,
              12,
              'Helvetica-BoldOblique',
            ),
          )
          .text(config.heading, 65, isCampaign ? 153 : 130, {
            width: 712,
            align: 'center',
            height: 45,
          });
        const date = new Date(snapshot.startsAt || snapshot.eventDate);
        const dateText = date.toLocaleDateString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
        const time = (value: string) =>
          new Date(value).toLocaleTimeString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            hour: '2-digit',
            minute: '2-digit',
          });
        const action =
          snapshot.role === 'SPEAKER'
            ? config.speakerAction || 'ministrou a palestra intitulada'
            : config.attendeeAction || 'participou da palestra intitulada';
        const text = `Certificamos que ${snapshot.studentName} ${action}: “${snapshot.eventTitle}”, ${snapshot.promoter ? `promovida por ${snapshot.promoter}, ` : ''}realizada no dia ${dateText}${snapshot.startsAt && snapshot.endsAt ? `, das ${time(snapshot.startsAt)} às ${time(snapshot.endsAt)}` : ''}, na ${config.edition}, com carga horária de ${snapshot.workload}.`;
        let size = 14;
        while (
          size > 10 &&
          doc
            .font('Helvetica-Bold')
            .fontSize(size)
            .heightOfString(text, { width: 702, lineGap: 8 }) > 124
        )
          size -= 0.5;
        if (
          doc.fontSize(size).heightOfString(text, { width: 702, lineGap: 8 }) >
          124
        )
          throw new BadRequestException(
            'Texto excede o espaço do modelo. Reduza os títulos antes de emitir.',
          );
        const tail = `”, ${snapshot.promoter ? `promovida por ${snapshot.promoter}, ` : ''}realizada no dia ${dateText}${snapshot.startsAt && snapshot.endsAt ? `, das ${time(snapshot.startsAt)} às ${time(snapshot.endsAt)}` : ''}, na ${config.edition}, com carga horária de ${snapshot.workload}.`;
        doc
          .font('Helvetica')
          .fillColor('#172A3C')
          .fontSize(size)
          .text('Certificamos que ', 70, isCampaign ? 215 : 205, {
            width: 702,
            align: 'left',
            lineGap: 8,
            height: 124,
            continued: true,
          });
        doc
          .font('Helvetica-BoldOblique')
          .text(snapshot.studentName, { continued: true });
        doc.font('Helvetica').text(` ${action}: “`, { continued: true });
        doc
          .font('Helvetica-BoldOblique')
          .text(snapshot.eventTitle, { continued: true });
        doc.font('Helvetica').text(tail, { continued: false });
        doc
          .font('Helvetica')
          .fontSize(14)
          .text(`São Paulo, ${dateText}.`, 80, 356, {
            width: 682,
            align: 'center',
            height: 30,
          });
        const width = 600 / signatures.length;
        signatures.forEach((signer, i) => {
          const x = 120 + i * width;
          doc.image(signer.image, x + (width - 110) / 2, 404, {
            fit: [110, 45],
            align: 'center',
            valign: 'center',
          });
          doc
            .moveTo(x + (width - Math.min(300, width - 20)) / 2, 457)
            .lineTo(x + (width + Math.min(300, width - 20)) / 2, 457)
            .lineWidth(0.5)
            .strokeColor('#000000')
            .stroke();
          doc
            .font('Helvetica-BoldOblique')
            .fontSize(
              this.fit(
                doc,
                signer.name,
                width,
                22,
                signatures.length > 1 ? 10 : 14,
                6,
                'Helvetica-BoldOblique',
              ),
            )
            .text(signer.name, x, 462, { width, align: 'center', height: 22 });
          doc
            .font('Helvetica')
            .fontSize(
              this.fit(
                doc,
                signer.title,
                width,
                42,
                signatures.length > 1 ? 9 : 13,
                7,
                'Helvetica',
              ),
            )
            .text(signer.title, x, 485, { width, align: 'center', height: 42 });
        });
        if (qr) {
          doc.image(qr, 755, 503, { width: 49, height: 49 });
          doc
            .font('Helvetica')
            .fontSize(6)
            .text(view.verificationCode, 570, 556, {
              width: 230,
              align: 'right',
              link: url,
              height: 10,
            });
        }
        if (preview)
          doc
            .save()
            .fillOpacity(0.25)
            .fillColor(
              config.design === 'TECHNOLOGY_BLUE_2026' ? '#073B70' : '#BA1A1A',
            )
            .font('Helvetica-Bold')
            .fontSize(48)
            .text('DEMONSTRAÇÃO', 130, 320, { width: 600, align: 'center' })
            .restore();
        doc.end();
      } catch (error) {
        doc.destroy();
        reject(
          error instanceof Error ? error : new Error('Falha ao gerar PDF.'),
        );
      }
    });
  }

  private fit(
    doc: PDFKit.PDFDocument,
    text: string,
    width: number,
    height: number,
    maximum: number,
    minimum: number,
    font: string,
  ) {
    for (let size = maximum; size >= minimum; size -= 0.5)
      if (
        doc.font(font).fontSize(size).heightOfString(text, { width }) <= height
      )
        return size;
    throw new BadRequestException(
      'Texto excede o espaço reservado no certificado. Revise o cadastro antes de publicar.',
    );
  }
  private drawBlueTechnologyLayout(doc: PDFKit.PDFDocument) {
    const asset = (name: string) => join(__dirname, 'assets', name);
    // Crop only the original circuit artwork; exclude all poster copy from the background.
    doc.save().rect(0, 0, 841.92, 595.32).clip();
    doc.image(asset('technology-2026-campaign-cover.png'), 0, 0, {
      width: 1488.09,
    });
    doc.restore();
    // The original banner supplies both campaign typography and the official Fatec identity.
    // Clip above its day/date label so each certificate uses its own activity date.
    doc.save().rect(66, 0, 710, 150).clip();
    doc.image(asset('technology-2026-campaign-banner.png'), 66, 0, {
      width: 710,
    });
    doc.restore();
    doc
      .save()
      .fillOpacity(0.97)
      .rect(54, 195, 734, 373)
      .fill('#FFFFFF')
      .restore();
    doc.image(asset('cps_logo_cor.png'), 70, 510, {
      fit: [85, 45],
      align: 'center',
      valign: 'center',
    });
  }

  private drawReferenceLayout(doc: PDFKit.PDFDocument, edition: string) {
    const asset = (name: string) => join(__dirname, 'assets', name);
    // Recursos gráficos originais extraídos do PDF fornecido; nenhuma assinatura/nome foi reutilizado.
    for (let i = 0; i < 4; i++)
      doc.image(
        asset(`technology-week-background-${i}.jpg`),
        34.32,
        31.2 + i * 152.16,
        { width: 781.2, height: i === 3 ? 75.84 : 152.16 },
      );
    doc.image(asset('technology-week-logo-1.jpg'), 48.36, 42.12, {
      width: 259.8,
      height: 70.08,
    });
    doc.image(asset('technology-week-logo-2.jpg'), 68.4, 46.56, {
      width: 90.96,
      height: 48.24,
    });
    doc.image(asset('technology-week-logo-0.jpg'), 497.04, 41.76, {
      width: 299.76,
      height: 58.8,
    });
    const mark = /^([IVX]+)\b/.exec(edition)?.[1] || 'XIII';
    doc
      .fillColor('#000000')
      .font('Helvetica-Bold')
      .fontSize(47)
      .text(mark, 301, 46, { width: 93, height: 60, align: 'right' });
    doc.fontSize(17).text('SEMANA DE\nTECNOLOGIA', 397, 51, {
      width: 125,
      height: 52,
      lineGap: -1,
    });
    doc
      .fillColor('#000000')
      .rect(36, 563.82, 785.92, 6)
      .rect(815.92, 36, 6, 533.82)
      .fill();
    doc
      .lineWidth(5.5)
      .strokeColor('#c00000')
      .rect(33, 33, 775.92, 529.32)
      .stroke();
  }
}
