import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { PdfGeneratorService } from '../certificate/pdf-generator.service';
import { EventStorageService } from './event-storage.service';
import { EventOperationsService } from './event-operations.service';
import { MailService } from '../mail/mail.service';
import type { CertificateView } from '../certificate/dto/view-certificate.dto';
import type { CertificateSnapshot } from '../certificate/certificate.snapshot';
import { createHash, randomUUID } from 'node:crypto';

@Injectable()
export class EventJobsService {
  private readonly logger = new Logger(EventJobsService.name);
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfGeneratorService,
    private readonly storage: EventStorageService,
    private readonly operations: EventOperationsService,
    private readonly mail: MailService,
  ) {}
  @Cron('*/10 * * * * *')
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.closeWindows();
      const pending = await this.prisma.certificateArtifact.findMany({
        where: {
          state: {
            in: ['PENDING_RENDER', 'RENDER_FAILED', 'RENDERING', 'READY'],
          },
          attempts: { lt: 5 },
          nextAttemptAt: { lte: new Date() },
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
          NOT: {
            state: 'READY',
            deliveryState: { in: ['SENT', 'EXPIRED', 'NONE', 'FAILED'] },
          },
        },
        take: 3,
      });
      for (const job of pending) await this.process(job.id);
      for (const series of await this.prisma.eventSeries.findMany({
        where: { purgedAt: null, retentionAt: { lte: new Date() } },
        select: { id: true },
        take: 10,
      }))
        await this.operations.purge(series.id);
      await this.prisma.presenceChallenge.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      await this.prisma.eventRateLimit.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      await this.prisma.visitorSession.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      await this.cleanupOrphans();
    } catch {
      this.logger.error(
        'Falha no processamento de eventos; nova tentativa agendada.',
      );
    } finally {
      this.running = false;
    }
  }
  async closeWindows() {
    const rows = await this.prisma.eventCheckpoint.findMany({
      where: { isOpen: true, closesAt: { lte: new Date() } },
      select: { id: true, eventId: true, type: true, version: true },
    });
    for (const cp of rows)
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT * FROM "EventCheckpoint" WHERE "eventId" = ${cp.eventId} ORDER BY "type" FOR UPDATE`;
        await tx.$queryRaw`SELECT * FROM "Event" WHERE "id" = ${cp.eventId} FOR UPDATE`;
        const changed = await tx.eventCheckpoint.updateMany({
          where: {
            id: cp.id,
            isOpen: true,
            version: cp.version,
            closesAt: { lte: new Date() },
          },
          data: {
            isOpen: false,
            closedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (changed.count)
          await tx.eventAudit.create({
            data: { eventId: cp.eventId, action: `WINDOW_EXPIRED_${cp.type}` },
          });
        if (changed.count && cp.type === 'CHECK_OUT')
          await tx.event.updateMany({
            where: { id: cp.eventId, status: 'IN_PROGRESS' },
            data: { status: 'COMPLETED' },
          });
      });
  }
  async process(id: string) {
    const leaseToken = randomUUID();
    const claimed = await this.prisma.certificateArtifact.updateMany({
      where: {
        id,
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: { leaseUntil: new Date(Date.now() + 120000), leaseToken },
    });
    if (!claimed.count) return;
    try {
      const job = await this.prisma.certificateArtifact.findUniqueOrThrow({
        where: { id },
        include: {
          certificate: {
            include: {
              participant: {
                include: { visitor: { include: { series: true } } },
              },
              event: true,
            },
          },
        },
      });
      const cert = job.certificate;
      if (cert.revokedAt || cert.event.status === 'CANCELLED') {
        await this.prisma.certificateArtifact.updateMany({
          where: { id, leaseToken },
          data: {
            state: 'REVOKED',
            deliveryState: 'EXPIRED',
            leaseUntil: null,
            leaseToken: null,
          },
        });
        return;
      }
      if (job.state !== 'READY') {
        const view: CertificateView = {
          id: cert.id,
          eventId: cert.eventId,
          attendanceId: cert.attendanceId,
          verificationCode: cert.verificationCode,
          issuedAt: cert.issuedAt.toISOString(),
          revokedAt: null,
          payloadSnapshot:
            cert.payloadSnapshot as unknown as CertificateSnapshot,
        };
        const buffer = await this.pdf.generatePdf(view);
        const plannedKey = `event-certificates/${randomUUID()}.pdf`;
        const pendingAsset = await this.prisma.eventAsset.create({
          data: {
            kind: 'PDF_PENDING',
            storageKey: plannedKey,
            sha256: createHash('sha256').update(buffer).digest('hex'),
          },
        });
        const asset = await this.storage.put(buffer, true, plannedKey);
        // O download também verifica revogação: cancelamento durante renderização não libera arquivo.
        const completed = await this.prisma.certificateArtifact.updateMany({
          where: { id, leaseToken, leaseUntil: { gt: new Date() } },
          data: { ...asset, state: 'READY' },
        });
        if (!completed.count) {
          await this.storage.remove(asset.storageKey, true);
          await this.prisma.eventAsset.delete({
            where: { id: pendingAsset.id },
          });
          return;
        }
        await this.prisma.eventAsset.delete({ where: { id: pendingAsset.id } });
      }
      const latest = await this.prisma.certificateArtifact.findFirst({
        where: { id, leaseToken, leaseUntil: { gt: new Date() } },
        include: {
          certificate: {
            include: {
              event: true,
              participant: {
                include: { visitor: { include: { series: true } } },
              },
            },
          },
        },
      });
      if (!latest) return;
      if (
        ['SENT', 'EXPIRED', 'NONE', 'FAILED'].includes(latest.deliveryState)
      ) {
        await this.prisma.certificateArtifact.updateMany({
          where: { id, leaseToken },
          data: { leaseUntil: null, leaseToken: null },
        });
        return;
      }
      const studentAppUrl = (
        process.env.STUDENT_APP_URL ||
        'https://carteirinha-digital-front-end-aluno.vercel.app'
      ).replace(/\/$/, '');
      const current = await this.prisma.certificate.findUniqueOrThrow({
        where: { id: cert.id },
      });
      if (current.revokedAt || latest.certificate.event?.status === 'CANCELLED') {
        await this.prisma.certificateArtifact.updateMany({
          where: { id, leaseToken },
          data: { deliveryState: 'EXPIRED', leaseUntil: null, leaseToken: null },
        });
        return;
      }
      const studentAccountId =
        latest.certificate.studentAccountId ||
        latest.certificate.participant?.accountId;
      const visitor = latest.certificate.participant?.visitor;

      if (studentAccountId) {
        const student = await this.prisma.student.findUnique({
          where: { accountId: studentAccountId },
          select: { ra: true, name: true, email: true, status: true },
        });
        if (!student || !student.email) {
          await this.prisma.certificateArtifact.updateMany({
            where: { id, leaseToken },
            data: { deliveryState: 'FAILED', leaseUntil: null, leaseToken: null },
          });
          return;
        }
        await this.mail.sendCertificateNotification({
          email: student.email,
          recipientName: student.name,
          eventTitle: latest.certificate.event.title,
          accessUrl: `${studentAppUrl}/certificados`,
          profile: 'ALUNO',
        });
        await this.prisma.certificateArtifact.updateMany({
          where: { id, leaseToken, deliveryState: 'PENDING' },
          data: { deliveryState: 'SENT' },
        });
      } else if (visitor) {
        if (!visitor.email) {
          await this.prisma.certificateArtifact.updateMany({
            where: { id, leaseToken },
            data: { deliveryState: 'FAILED', leaseUntil: null, leaseToken: null },
          });
          return;
        }
        if (
          visitor.series.purgedAt ||
          visitor.series.retentionAt <= new Date()
        ) {
          await this.prisma.certificateArtifact.updateMany({
            where: { id, leaseToken },
            data: { deliveryState: 'EXPIRED', leaseUntil: null, leaseToken: null },
          });
          return;
        }
        await this.mail.sendCertificateNotification({
          email: visitor.email,
          recipientName: visitor.name,
          eventTitle: latest.certificate.event.title,
          accessUrl: `${studentAppUrl}/visitantes/certificados`,
          profile: 'VISITANTE',
        });
        await this.prisma.certificateArtifact.updateMany({
          where: { id, leaseToken, deliveryState: 'PENDING' },
          data: { deliveryState: 'SENT' },
        });
      } else {
        await this.prisma.certificateArtifact.updateMany({
          where: { id, leaseToken },
          data: { deliveryState: 'NONE' },
        });
      }
      await this.prisma.certificateArtifact.updateMany({
        where: { id, leaseToken },
        data: { leaseUntil: null, leaseToken: null },
      });
    } catch {
      const current = await this.prisma.certificateArtifact.findUnique({
        where: { id },
      });
      if (current)
        await this.prisma.certificateArtifact.updateMany({
          where: { id, leaseToken },
          data: {
            state: current.state === 'READY' ? 'READY' : 'RENDER_FAILED',
            attempts: current.state === 'READY' ? undefined : { increment: 1 },
            deliveryAttempts:
              current.state === 'READY' ? { increment: 1 } : undefined,
            deliveryState:
              current.state === 'READY' && current.deliveryAttempts >= 4
                ? 'FAILED'
                : current.deliveryState,
            nextAttemptAt: new Date(
              Date.now() +
                60000 *
                  2 ** Math.min(current.attempts + current.deliveryAttempts, 5),
            ),
            leaseUntil: null,
            leaseToken: null,
          },
        });
    }
  }
  async cleanupOrphans() {
    const rows = await this.prisma.eventAsset.findMany({
      where: {
        kind: 'PDF_PENDING',
        createdAt: { lt: new Date(Date.now() - 86400000) },
      },
      take: 10,
    });
    for (const row of rows) {
      const used = await this.prisma.certificateArtifact.findFirst({
        where: { storageKey: row.storageKey },
        select: { id: true },
      });
      if (!used) await this.storage.remove(row.storageKey, true);
      await this.prisma.eventAsset.delete({ where: { id: row.id } });
    }
  }
}
