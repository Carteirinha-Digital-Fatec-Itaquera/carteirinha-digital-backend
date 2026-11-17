import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { UploadService } from '../upload/upload.service';

const STAGING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class EmployeeMaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  @Cron('0 0 3 * * *')
  async cleanupExpiredImportStaging(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.purgeOldImportRows();
    await this.cleanupPendingPhotos();
  }

  async cleanupPendingPhotos(now: Date = new Date()): Promise<number> {
    const pending = await this.prisma.employeePhoto.findMany({
      where: {
        processingState: { in: ['DELETE_PENDING', 'FAILED'] },
        cleanupAttempts: { lt: 5 },
        OR: [{ nextCleanupAt: null }, { nextCleanupAt: { lte: now } }],
      },
      take: 25,
    });

    let cleaned = 0;
    for (const photo of pending) {
      try {
        await this.uploadService.deletePrivateEmployeePhoto(photo.storageKey);
        await this.prisma.employeePhoto.update({
          where: { id: photo.id },
          data: { processingState: 'DELETED' },
        });
        cleaned++;
      } catch {
        const nextDelayMs = (photo.cleanupAttempts + 1) * 5 * 60_000;
        await this.prisma.employeePhoto.update({
          where: { id: photo.id },
          data: {
            cleanupAttempts: { increment: 1 },
            nextCleanupAt: new Date(now.getTime() + nextDelayMs),
          },
        });
      }
    }
    return cleaned;
  }

  async purgeOldImportRows(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - STAGING_RETENTION_MS);

    await this.prisma.employeeImportBatch.updateMany({
      where: {
        state: 'ANALYZED',
        expiresAt: { lt: now },
      },
      data: { state: 'EXPIRED' },
    });

    // Keep batch summary/fileHash/audits; purge raw row inputs after 30 days
    const deleted = await this.prisma.employeeImportRow.deleteMany({
      where: {
        batch: {
          state: { in: ['COMPLETED', 'PARTIAL', 'CANCELLED', 'EXPIRED'] },
          OR: [{ finishedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
        },
      },
    });

    return deleted.count;
  }
}
