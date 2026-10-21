import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type { TokenPayload } from '../auth/dto/payload.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SecretaryActiveGuard } from '../project-credits/guards/secretary-active.guard';
import { PrismaService } from '../database/prisma.service';
import { AttendanceQrReferenceService } from '../attendance/attendance-qr-reference.service';
import { AttendanceService } from '../attendance/attendance.service';
import { TechnologyPdfService } from '../certificate/technology-pdf.service';
import {
  EventCatalogService,
  type TemplateConfig,
} from './event-catalog.service';
import { EventOperationsService } from './event-operations.service';
import { VisitorService } from './visitor.service';
import {
  EventConfigurationDto,
  ManualPresenceDto,
  RegisterVisitorDto,
  SeriesDto,
  SignerDto,
  TemplateDto,
  VerifyVisitorDto,
  VisitorScanDto,
  StudentChallengeDto,
  SignerSelectionDto,
  RoleMutationDto,
  ParticipantCorrectionDto,
  CreateEventFeedbackDto,
} from './public-events.dto';
import { EventStorageService } from './event-storage.service';
import { NoStoreInterceptor } from './no-store.interceptor';
import { defaultEventVenue } from './event-venue.config';

const validation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
});
type AuthRequest = Request & { user: TokenPayload };
function cookie(req: Request) {
  return req.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith('event_visitor='))
    ?.slice(14);
}
function requireOrigin(req: Request) {
  const allowed = new Set([
    process.env.STUDENT_APP_URL ||
      'https://carteirinha-digital-front-end-aluno.vercel.app',
  ]);
  const localDevelopment =
    process.env.NODE_ENV !== 'production' &&
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(req.headers.origin || '');
  if (
    !req.headers.origin ||
    (!allowed.has(req.headers.origin) && !localDevelopment)
  )
    throw new BadRequestException('Origem de acesso inválida.');
}

@Controller('public/events')
@UseInterceptors(NoStoreInterceptor)
export class PublicEventsController {
  constructor(
    private readonly catalog: EventCatalogService,
    private readonly refs: AttendanceQrReferenceService,
    private readonly visitors: VisitorService,
    private readonly operations: EventOperationsService,
    private readonly prisma: PrismaService,
  ) {}
  @Post(':id/feedback')
  feedback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validation) dto: CreateEventFeedbackDto,
  ) {
    return this.operations.submitFeedback(id, dto);
  }
  @Get('series') list() {
    return this.catalog.publicSeries();
  }
  @Get('series/:slug') series(@Param('slug') slug: string) {
    return this.catalog.publicSeries(slug);
  }
  @Get('qr/:reference') async preview(
    @Param('reference') ref: string,
    @Req() req: Request,
  ) {
    await this.visitors.limit(`qr:${req.ip}`, 6000, 60);
    const row = await this.refs.resolveReference(ref);
    const event = row.checkpoint.event;
    return {
      event: {
        id: event.id,
        title: event.title,
        description: event.description,
        location: event.location,
        speaker: event.speaker,
        startsAt: event.startsAt?.toISOString(),
        endsAt: event.endsAt?.toISOString(),
        workloadMinutes: event.workloadMinutes,
      },
      checkpoint: { type: row.checkpoint.type },
      visitorsAllowed: event.visitorsAllowed,
      seriesId: event.seriesId,
      locationRequired: Boolean(event.geoPolicy),
      expiresAt: row.expiresAt.toISOString(),
      serverTime: new Date().toISOString(),
    };
  }

  @Get(':id') async getPublicEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.visitors.limit(`event:${req.ip}`, 6000, 60);
    const event = await this.prisma.event.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        speaker: true,
        startsAt: true,
        endsAt: true,
        workloadMinutes: true,
        status: true,
        visitorsAllowed: true,
        seriesId: true,
        geoPolicy: true,
        checkpoints: {
          select: {
            type: true,
            isOpen: true,
          },
        },
      },
    });
    if (!event) {
      throw new NotFoundException('Evento não encontrado.');
    }
    return {
      event: {
        id: event.id,
        title: event.title,
        description: event.description,
        location: event.location,
        speaker: event.speaker,
        startsAt: event.startsAt?.toISOString(),
        endsAt: event.endsAt?.toISOString(),
        startDate: event.startsAt?.toISOString(),
        endDate: event.endsAt?.toISOString(),
        workloadMinutes: event.workloadMinutes,
        status: event.status,
        checkpoints: event.checkpoints,
      },
      visitorsAllowed: event.visitorsAllowed,
      seriesId: event.seriesId,
      locationRequired: Boolean(event.geoPolicy),
      serverTime: new Date().toISOString(),
    };
  }
}

@Controller('visitor')
@UseInterceptors(NoStoreInterceptor)
export class VisitorController {
  constructor(
    private readonly visitors: VisitorService,
    private readonly prisma: PrismaService,
    private readonly refs: AttendanceQrReferenceService,
    private readonly attendance: AttendanceService,
    private readonly operations: EventOperationsService,
  ) {}
  @Post('registration') @HttpCode(200) async register(
    @Body(validation) dto: RegisterVisitorDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    requireOrigin(req);
    const result = await this.visitors.register(
      dto,
      req.ip || 'unknown',
      cookie(req),
    );
    res.cookie('event_visitor', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: result.expiresAt,
    });
    return {
      success: true,
      expiresAt: result.expiresAt,
      registrationId: result.visitorId,
      message: 'Identificação concluída.',
    };
  }
  @Post('verify') @HttpCode(200) async verify(
    @Body(validation) dto: VerifyVisitorDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    requireOrigin(req);
    const result = await this.visitors.verify(dto, req.ip || 'unknown');
    res.cookie('event_visitor', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: result.expiresAt,
    });
    return { expiresAt: result.expiresAt };
  }
  @Get('session') async session(@Req() req: Request) {
    const visitor = await this.visitors.session(cookie(req));
    return {
      id: visitor.id,
      name: visitor.name,
      course: visitor.course,
      seriesId: visitor.seriesId,
      retentionAt: visitor.series.retentionAt,
      identifiedAt: visitor.identifiedAt?.toISOString() || null,
      verifiedAt: visitor.verifiedAt?.toISOString() || null,
      isSelfDeclared: Boolean(visitor.identifiedAt && !visitor.verifiedAt),
    };
  }
  @Post('logout') @HttpCode(200) async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    requireOrigin(req);
    await this.visitors.logout(cookie(req));
    res.clearCookie('event_visitor', { path: '/' });
    return { success: true };
  }
  @Post('enroll/:eventId') async enroll(
    @Param('eventId', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    requireOrigin(req);
    const visitor = await this.visitors.session(cookie(req));
    return this.visitors.participant(visitor.id, id);
  }
  @Post('challenge') async challenge(
    @Body(validation) dto: VisitorScanDto,
    @Req() req: Request,
  ) {
    requireOrigin(req);
    const visitor = await this.visitors.session(cookie(req));
    await this.visitors.limit(`challenge:${visitor.id}`, 30, 60);
    const record = await this.refs.resolveReference(dto.reference);
    const participant = await this.visitors.participant(
      visitor.id,
      record.checkpoint.eventId,
    );
    const challenge = await this.prisma.presenceChallenge.create({
      data: {
        identity: participant.id,
        eventId: record.checkpoint.eventId,
        checkpoint: record.checkpoint.type,
        checkpointVersion: record.checkpoint.version,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    return { challengeId: challenge.id };
  }
  @Post('attendance') @HttpCode(200) async scan(
    @Body(validation) dto: VisitorScanDto,
    @Req() req: Request,
  ) {
    requireOrigin(req);
    const visitor = await this.visitors.session(cookie(req));
    await this.visitors.limit(`scan:${visitor.id}`, 60, 60);
    const row = await this.refs.resolveReference(dto.reference);
    const participant = await this.visitors.participant(
      visitor.id,
      row.checkpoint.eventId,
    );
    return this.attendance.scan(
      row.jwtToken,
      null,
      dto.position,
      participant.id,
    );
  }
  @Get('attendances') async attendances(@Req() req: Request) {
    const visitor = await this.visitors.session(cookie(req));
    return this.prisma.attendance.findMany({
      where: { participant: { visitorId: visitor.id } },
      select: {
        id: true,
        eventId: true,
        checkInAt: true,
        checkOutAt: true,
        status: true,
        event: {
          select: {
            id: true,
            title: true,
            speaker: true,
            location: true,
            startsAt: true,
            endsAt: true,
            workloadMinutes: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  @Get('certificates') async certificates(@Req() req: Request) {
    const visitor = await this.visitors.session(cookie(req));
    return this.prisma.certificate.findMany({
      where: { participant: { visitorId: visitor.id } },
      select: {
        id: true,
        verificationCode: true,
        issuedAt: true,
        revokedAt: true,
        event: { select: { title: true } },
        artifact: { select: { state: true } },
      },
      orderBy: { issuedAt: 'desc' },
    });
  }
  @Get('certificates/:id/pdf') async pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const visitor = await this.visitors.session(cookie(req));
    const file = await this.operations.download(id, visitor.id);
    res
      .type('application/pdf')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${file.code}.pdf"`,
      );
    res.send(file.buffer);
  }
}

@Controller('attendances')
@UseGuards(AuthGuard, RolesGuard)
@Roles('student')
export class StudentLocationController {
  constructor(
    private readonly refs: AttendanceQrReferenceService,
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
  ) {}
  @Post('location-challenge') async challenge(
    @Body(validation) dto: StudentChallengeDto,
    @Req() req: AuthRequest,
  ) {
    const row = dto.reference
      ? (await this.refs.resolveReference(dto.reference)).checkpoint
      : null;
    const claims =
      !row && dto.qrToken ? await this.attendance.verifyQr(dto.qrToken) : null;
    const eventId = row?.eventId || claims?.eventId;
    if (!eventId) throw new BadRequestException('QR obrigatório.');
    const student = await this.prisma.student.findFirst({
      where: { ra: String(req.user.sub), accountId: req.user.accountId },
    });
    if (!student || !req.user.accountId)
      throw new BadRequestException('Conta inválida.');
    const challenge = await this.prisma.presenceChallenge.create({
      data: {
        identity: req.user.accountId,
        eventId,
        checkpoint: row?.type || claims!.checkpoint,
        checkpointVersion: row?.version || claims!.checkpointVersion,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    return { challengeId: challenge.id };
  }
}

@Controller('event-management')
@UseGuards(AuthGuard, RolesGuard, SecretaryActiveGuard)
@Roles('secretary')
@UseInterceptors(NoStoreInterceptor)
export class EventManagementController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: EventCatalogService,
    private readonly operations: EventOperationsService,
    private readonly pdf: TechnologyPdfService,
    private readonly storage: EventStorageService,
  ) {}
  @Get('catalog') async catalogData() {
    await this.catalog.ensureDefaultTemplates();
    const [series, templates, signers, events] = await Promise.all([
      this.prisma.eventSeries.findMany({ orderBy: { startsAt: 'desc' } }),
      this.prisma.certificateTemplate.findMany({
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.certificateSigner.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.event.findMany({ orderBy: { startsAt: 'desc' } }),
    ]);
    return {
      series,
      templates,
      signers,
      events,
      defaultVenue: defaultEventVenue(),
    };
  }
  @Post('series') series(
    @Body(validation) dto: SeriesDto,
    @Req() req: AuthRequest,
  ) {
    return this.catalog.series(dto, Number(req.user.sub));
  }
  @Patch('series/:id') updateSeries(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validation) dto: SeriesDto,
    @Req() req: AuthRequest,
  ) {
    return this.catalog.series(dto, Number(req.user.sub), id);
  }
  @Post('assets/:kind')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  upload(
    @Param('kind') kind: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthRequest,
  ) {
    return this.catalog.upload(file, kind, Number(req.user.sub));
  }
  @Get('assets/:id') async asset(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const asset = await this.prisma.eventAsset.findUniqueOrThrow({
      where: { id },
    });
    res.type('image/png').send(await this.storage.get(asset.storageKey));
  }
  @Post('templates') template(
    @Body(validation) dto: TemplateDto,
    @Req() req: AuthRequest,
  ) {
    return this.catalog.template(dto, Number(req.user.sub));
  }
  @Post('templates/:id/publish') publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.catalog.templateStatus(id, 'PUBLISHED', Number(req.user.sub));
  }
  @Post('templates/:id/archive') archiveTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.catalog.templateStatus(id, 'ARCHIVED', Number(req.user.sub));
  }
  @Post('signers') signer(
    @Body(validation) dto: SignerDto,
    @Req() req: AuthRequest,
  ) {
    return this.catalog.signer(dto, Number(req.user.sub));
  }
  @Post('signers/:id/archive') archiveSigner(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.catalog.archiveSigner(id, Number(req.user.sub));
  }
  @Post('events/:id/configure') configure(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validation) dto: EventConfigurationDto,
    @Req() req: AuthRequest,
  ) {
    return this.catalog.configure(id, dto, Number(req.user.sub));
  }
  @Get('events/:id/participants') participants(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.operations.participants(id);
  }
  @Get('events/:id/audit') audit(@Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.eventAudit.findMany({
      where: { eventId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
  @Get('events/:id/feedback') feedbackMetrics(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.operations.getFeedbackMetrics(id);
  }
  @Post('events/:id/manual-presence') manual(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validation) dto: ManualPresenceDto,
    @Req() req: AuthRequest,
  ) {
    return this.operations.manual(id, dto, Number(req.user.sub));
  }
  @Post('participants/:id/role') role(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validation) dto: RoleMutationDto,
    @Req() req: AuthRequest,
  ) {
    return this.operations.assignRole(
      id,
      dto.role,
      dto.reason || '',
      Number(req.user.sub),
    );
  }
  @Get('certificates/:id/pdf') async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const file = await this.operations.download(id);
    res
      .type('application/pdf')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${file.code}.pdf"`,
      );
    res.send(file.buffer);
  }
  @Post('certificates/:id/retry') retry(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.operations.retry(id, Number(req.user.sub));
  }
  @Patch('participants/:id') correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validation) dto: ParticipantCorrectionDto,
    @Req() req: AuthRequest,
  ) {
    return this.operations.correct(id, dto, Number(req.user.sub));
  }
  @Post('templates/:id/preview') async preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(validation) dto: SignerSelectionDto,
    @Res() res: Response,
  ) {
    if (
      !Array.isArray(dto.signerIds) ||
      dto.signerIds.length < 1 ||
      dto.signerIds.length > 3
    )
      throw new BadRequestException('Selecione os assinantes para a prévia.');
    const template = await this.prisma.certificateTemplate.findUniqueOrThrow({
      where: { id },
    });
    const signers = await this.prisma.certificateSigner.findMany({
      where: { id: { in: dto.signerIds }, archived: false },
    });
    const buffer = await this.pdf.render(
      {
        id: 'preview',
        eventId: 'preview',
        attendanceId: 'preview',
        verificationCode: 'DEMONSTRACAO-SEM-VALIDADE',
        issuedAt: new Date().toISOString(),
        revokedAt: null,
        payloadSnapshot: {
          version: 2,
          studentName: 'Nome completo de demonstração',
          studentRa: '',
          course: '',
          eventTitle: 'Título da palestra de demonstração',
          eventDate: '2026-10-26',
          workload: '2 horas',
          speaker: 'Palestrante de demonstração',
          institution: 'Fatec Itaquera',
          role: template.role,
          startsAt: '2026-10-26T18:00:00Z',
          endsAt: '2026-10-26T20:00:00Z',
          template: {
            id,
            version: template.version,
            ...(template.config as unknown as TemplateConfig),
          },
          signers: signers.map((s) => ({
            id: s.id,
            name: s.name,
            title: s.title,
            assetId: s.assetId,
          })),
        },
      },
      true,
    );
    res.type('application/pdf').send(buffer);
  }
}
