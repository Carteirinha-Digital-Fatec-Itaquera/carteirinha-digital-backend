import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { TokenPayload } from '../auth/dto/payload.dto';
import { SecretaryActiveGuard } from '../project-credits/guards/secretary-active.guard';
import { NoStoreInterceptor } from '../public-events/no-store.interceptor';
import { SupportService } from './support.service';
import {
  SupportActionDto,
  SupportCreateDto,
  SupportQueryDto,
  SupportReadDto,
} from './support.dto';
type Request = { user: TokenPayload };
const validation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

@Controller('support/tickets')
@UseGuards(AuthGuard, RolesGuard)
@Roles('student')
@UsePipes(validation)
@UseInterceptors(NoStoreInterceptor)
export class SupportController {
  constructor(private readonly service: SupportService) {}
  @Post() create(@Req() req: Request, @Body() body: SupportCreateDto) {
    return this.service.create(req.user, body);
  }
  @Get('me') list(@Req() req: Request, @Query() query: SupportQueryDto) {
    return this.service.list(req.user, query);
  }
  @Get(':id') detail(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SupportQueryDto,
  ) {
    return this.service.detail(req.user, id, query);
  }
  @Post(':id/messages') message(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportActionDto,
  ) {
    return this.service.act(req.user, id, 'MESSAGE', body);
  }
  @Post(':id/read') read(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportReadDto,
  ) {
    return this.service.read(req.user, id, body.version);
  }
  @Post(':id/close') close(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportActionDto,
  ) {
    return this.service.act(req.user, id, 'CLOSE', body);
  }
  @Post(':id/reopen') reopen(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportActionDto,
  ) {
    return this.service.act(req.user, id, 'REOPEN', body);
  }
}

@Controller('support/admin')
@UseGuards(AuthGuard, RolesGuard, SecretaryActiveGuard)
@Roles('secretary')
@UsePipes(validation)
@UseInterceptors(NoStoreInterceptor)
export class SupportAdminController {
  constructor(private readonly service: SupportService) {}
  @Get('summary') summary(@Req() req: Request) {
    return this.service.summary(req.user);
  }
  @Get('assignees') assignees(@Req() req: Request) {
    return this.service.assignees(req.user);
  }
  @Get('tickets') list(@Req() req: Request, @Query() query: SupportQueryDto) {
    return this.service.list(req.user, query, true);
  }
  @Get('tickets/:id') detail(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SupportQueryDto,
  ) {
    return this.service.detail(req.user, id, query, true);
  }
  @Get('tickets/:id/audit') audit(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.audit(req.user, id);
  }
  @Post('tickets/:id/read') read(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportReadDto,
  ) {
    return this.service.read(req.user, id, body.version, true);
  }
  @Post('tickets/:id/claim') claim(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportActionDto,
  ) {
    return this.service.act(req.user, id, 'CLAIM', body, true);
  }
  @Patch('tickets/:id/assignee') assign(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportActionDto,
  ) {
    return this.service.act(req.user, id, 'ASSIGNEE', body, true);
  }
  @Post('tickets/:id/messages') message(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportActionDto,
  ) {
    return this.service.act(req.user, id, 'MESSAGE', body, true);
  }
  @Post('tickets/:id/status') status(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SupportActionDto,
  ) {
    return this.service.act(req.user, id, 'STATUS', body, true);
  }
  @Post('tickets/:id/messages/:messageId/redact') redact(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() body: SupportActionDto,
  ) {
    return this.service.act(req.user, id, 'REDACT', body, true, messageId);
  }
}
