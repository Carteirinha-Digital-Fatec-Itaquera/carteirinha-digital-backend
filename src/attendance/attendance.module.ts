import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import {
  AttendanceController,
  EventAttendanceController,
} from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [AttendanceController, EventAttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
