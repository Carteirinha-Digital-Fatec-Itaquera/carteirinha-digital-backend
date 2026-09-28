import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TokenPayload } from '../auth/dto/payload.dto';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateEventDto } from './dto/create-event.dto';
import { EventQueryDto } from './dto/event-query.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventService } from './event.service';

interface AuthenticatedRequest {
  user: TokenPayload;
}

@Controller('events')
@UseGuards(AuthGuard, RolesGuard)
export class EventController {
  constructor(private readonly eventService: EventService) {}

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
  ) {
    return this.eventService.update(id, dto);
  }
}
