import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TokenPayload } from '../auth/dto/payload.dto';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ActiveEventAccountGuard } from '../auth/active-event-account.guard';
import { CheckpointService } from './checkpoint.service';
import { CheckpointTypePipe } from './checkpoint-type.pipe';
import { CancelEventDto } from './dto/cancel-event.dto';
import { CreateEventDto } from './dto/create-event.dto';
import { EventQueryDto } from './dto/event-query.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventService } from './event.service';
import { QrTokenService } from './qr-token.service';

interface AuthenticatedRequest {
  user: TokenPayload;
}

@Controller('events')
@UseGuards(AuthGuard, RolesGuard, ActiveEventAccountGuard)
export class EventController {
  constructor(
    private readonly eventService: EventService,
    private readonly checkpointService: CheckpointService,
    private readonly qrTokenService: QrTokenService,
  ) {}

  @Post()
  @Roles('secretary')
  create(
    @Body() dto: CreateEventDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.eventService.create(dto, Number(request.user.sub));
  }
  @Get()
  @Roles('student', 'secretary')
  findAll(
    @Query() query: EventQueryDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.eventService.findAll(query, request.user.role);
  }

  @Post(':id/checkpoints/:type/open')
  @Roles('secretary')
  @HttpCode(HttpStatus.OK)
  openCheckpoint(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('type', new CheckpointTypePipe())
    type: ReturnType<CheckpointTypePipe['transform']>,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.checkpointService.open(id, type, Number(request.user.sub));
  }

  @Post(':id/checkpoints/:type/close')
  @Roles('secretary')
  @HttpCode(HttpStatus.OK)
  closeCheckpoint(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('type', new CheckpointTypePipe())
    type: ReturnType<CheckpointTypePipe['transform']>,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.checkpointService.close(id, type, Number(request.user.sub));
  }
  @Get(':id/checkpoints/:type/qr')
  @Roles('secretary')
  @Header('Cache-Control', 'no-store')
  async getCheckpointQr(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('type', new CheckpointTypePipe())
    type: ReturnType<CheckpointTypePipe['transform']>,
  ) {
    const checkpoint = await this.checkpointService.getOpen(id, type);
    return this.qrTokenService.generate({
      eventId: id,
      checkpoint: checkpoint.type,
      checkpointVersion: checkpoint.version,
      checkpointId: checkpoint.id,
      closesAt: checkpoint.closesAt,
    });
  }

  @Post(':id/checkpoints/:type/qr/refresh')
  @Roles('secretary')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async refreshCheckpointQr(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('type', new CheckpointTypePipe())
    type: ReturnType<CheckpointTypePipe['transform']>,
    @Request() request: AuthenticatedRequest,
  ) {
    const checkpoint = await this.checkpointService.refreshQr(
      id,
      type,
      Number(request.user.sub),
    );
    return this.qrTokenService.generate({
      eventId: id,
      checkpoint: checkpoint.type,
      checkpointVersion: checkpoint.version,
      checkpointId: checkpoint.id,
      closesAt: checkpoint.closesAt,
    });
  }

  @Get(':id')
  @Roles('student', 'secretary')
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.eventService.findOne(id, request.user.role);
  }

  @Patch(':id')
  @Roles('secretary')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateEventDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.eventService.update(id, dto, Number(request.user.sub));
  }

  @Post(':id/cancel')
  @Roles('secretary')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelEventDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.eventService.cancel(id, dto.reason, Number(request.user.sub));
  }

  @Post(':id/restore')
  @Roles('secretary')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  restore(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: CancelEventDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.eventService.restore(id, dto.reason, Number(request.user.sub));
  }

  @Delete(':id')
  @Roles('secretary')
  @HttpCode(HttpStatus.OK)
  delete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.eventService.delete(id, Number(request.user.sub));
  }
}
