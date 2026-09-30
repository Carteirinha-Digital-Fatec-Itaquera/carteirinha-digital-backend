import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AttendanceQrCleanupService {
  private readonly logger = new Logger(AttendanceQrCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron(): Promise<number> {
    return this.cleanupExpiredReferences();
  }

  async cleanupExpiredReferences(): Promise<number> {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const result = await this.prisma.attendanceQrReference.deleteMany({
        where: {
          expiresAt: {
            lt: fiveMinutesAgo,
          },
        },
      });

      if (result.count > 0) {
        this.logger.log(
          `Limpeza de QR codes de presença: ${result.count} referências expiradas removidas.`,
        );
      }
      return result.count;
    } catch (error) {
      this.logger.error('Erro ao executar limpeza de referências QR expiradas', error);
      return 0;
    }
  }
}
