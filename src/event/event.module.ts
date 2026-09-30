import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { CheckpointService } from './checkpoint.service';
import { EventController } from './event.controller';
import { EventService } from './event.service';
import { QrTokenService } from './qr-token.service';

import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [DatabaseModule, AuthModule, AttendanceModule],
  controllers: [EventController],
  providers: [EventService, CheckpointService, QrTokenService],
  exports: [EventService, CheckpointService, QrTokenService],
})
export class EventModule {}
