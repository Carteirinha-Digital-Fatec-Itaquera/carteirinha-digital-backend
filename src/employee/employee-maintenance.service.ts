import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';

const STAGING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class EmployeeMaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 0 3 * * *')
  async cleanupExpiredImportStaging(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.purgeOldImportRows();
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
