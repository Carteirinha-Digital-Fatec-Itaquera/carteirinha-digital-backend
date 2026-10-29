import { OfflineAttendanceController } from './offline-attendance.controller';
import { OfflineAttendanceService } from './offline-attendance.service';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import {
  AttendanceController,
  EventAttendanceController,
} from './attendance.controller';
import { AttendanceService } from './attendance.service';

import { CertificateModule } from '../certificate/certificate.module';
import { AttendanceQrReferenceService } from './attendance-qr-reference.service';
import { AttendanceQrCleanupService } from './attendance-qr-cleanup.service';
import { ActiveEventAccountGuard } from '../auth/active-event-account.guard';

@Module({
  imports: [DatabaseModule, AuthModule, CertificateModule],
  controllers: [
    AttendanceController,
    EventAttendanceController,
    OfflineAttendanceController,
  ],
  providers: [
    ActiveEventAccountGuard,
    AttendanceService,
    OfflineAttendanceService,
    AttendanceQrReferenceService,
    AttendanceQrCleanupService,
  ],
  exports: [AttendanceService, AttendanceQrReferenceService],
})
export class AttendanceModule {}
