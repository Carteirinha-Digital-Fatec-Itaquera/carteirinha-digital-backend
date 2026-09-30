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

@Controller('attendances')
@UseGuards(AuthGuard, RolesGuard)
@Roles('student')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

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
