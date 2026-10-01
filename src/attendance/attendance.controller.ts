import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { TokenPayload } from '../auth/dto/payload.dto';
import { AttendanceService } from './attendance.service';
import { ScanQrDto } from './dto/scan-qr.dto';

import { AttendanceQrReferenceService } from './attendance-qr-reference.service';
import { ScanReferenceDto } from './dto/scan-reference.dto';

@Controller('attendances')
@UseGuards(AuthGuard, RolesGuard)
@Roles('student')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly attendanceQrReferenceService: AttendanceQrReferenceService,
  ) {}

  @Post('scan')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  scan(
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: ScanQrDto,
    @Request() request: { user: TokenPayload },
  ) {
    return this.attendance.scan(dto.qrToken, request.user);
  }

  @Get('qr/:reference')
  @Header('Cache-Control', 'no-store')
  async getQrPreview(@Param('reference') reference: string) {
    const record =
      await this.attendanceQrReferenceService.resolveReference(reference);
    return {
      event: {
        id: record.checkpoint.event.id,
        title: record.checkpoint.event.title,
        speaker: record.checkpoint.event.speaker,
        location: record.checkpoint.event.location,
      },
      checkpoint: {
        type: record.checkpoint.type,
      },
      expiresAt: record.expiresAt.toISOString(),
      serverTime: new Date().toISOString(),
    };
  }

  @Post('scan-reference')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async scanReference(
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: ScanReferenceDto,
    @Request() request: { user: TokenPayload },
  ) {
    const record =
      await this.attendanceQrReferenceService.resolveReference(dto.qrReference);
    return this.attendance.scan(record.jwtToken, request.user);
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@Request() request: { user: TokenPayload }) {
    return this.attendance.findMine(request.user);
  }
}

@Controller('events')
@UseGuards(AuthGuard, RolesGuard)
@Roles('secretary')
export class EventAttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get(':id/attendances')
  @Header('Cache-Control', 'no-store')
  list(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.attendance.findByEvent(id);
  }

  @Get(':id/attendances/summary')
  @Header('Cache-Control', 'no-store')
  summary(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.attendance.summary(id);
  }
}
