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

@Module({
  imports: [DatabaseModule, AuthModule, CertificateModule],
  controllers: [AttendanceController, EventAttendanceController],
  providers: [
    AttendanceService,
    AttendanceQrReferenceService,
    AttendanceQrCleanupService,
  ],
  exports: [AttendanceService, AttendanceQrReferenceService],
})
export class AttendanceModule {}
