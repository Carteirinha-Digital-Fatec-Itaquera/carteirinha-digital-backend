import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Event } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { EventStorageService } from './event-storage.service';
import {
  EventConfigurationDto,
  SeriesDto,
  SignerDto,
  TemplateDto,
} from './public-events.dto';
import { assertGeoPolicy } from './presence-policy';

export interface TemplateConfig {
  heading: string;
  edition: string;
  backgroundAssetId?: string;
}
export interface CertificatePolicy {
  ATTENDEE: { templateId: string; signerIds: string[] };
  SPEAKER: { templateId: string; signerIds: string[] };
}
@Injectable()
export class EventCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: EventStorageService,
  ) {}
  async audit(
    action: string,
    secretaryId: number,
    subjectId?: string,
    eventId?: string,
  ) {
    await this.prisma.eventAudit.create({
      data: { action, secretaryId, subjectId, eventId },
    });
  }
  async series(dto: SeriesDto, secretaryId: number, id?: string) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dto.slug) || dto.courses.length > 40)
      throw new BadRequestException('Slug ou catálogo de cursos inválido.');
    const startsAt = new Date(dto.startsAt),
      endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt)
      throw new BadRequestException('Fim deve ser posterior ao início.');
    const retentionAt = new Date(endsAt.getTime() + 30 * 86400000);
    return this.prisma.$transaction(async (tx) => {
      if (id) {
        const old = await tx.eventSeries.findUnique({ where: { id } });
        if (!old || old.purgedAt)
          throw new ConflictException(
            'Edição arquivada não pode ser alterada.',
          );
        if (
          await tx.event.count({
            where: {
              seriesId: id,
              OR: [{ startsAt: { lt: startsAt } }, { endsAt: { gt: endsAt } }],
            },
          })
        )
          throw new BadRequestException(
            'O período da edição deve abranger todas as atividades cadastradas.',
          );
      }
      const data = {
        ...dto,
        startsAt,
        endsAt,
        retentionAt,
        courses: [...new Set(dto.courses)],
      };
      const row = id
        ? await tx.eventSeries.update({ where: { id }, data })
        : await tx.eventSeries.create({ data });
      await tx.eventAudit.create({
        data: { action: 'SERIES_SAVED', secretaryId, subjectId: row.id },
      });
      return row;
    });
  }
  async upload(file: Express.Multer.File, kind: string, secretaryId: number) {
    const stored = await this.storage.image(file, kind);
    const row = await this.prisma.eventAsset.create({
      data: { kind, ...stored },
    });
    await this.audit('ASSET_UPLOADED', secretaryId, row.id);
    return { id: row.id, kind: row.kind, sha256: row.sha256 };
  }
  async template(dto: TemplateDto, secretaryId: number) {
    if (
      dto.backgroundAssetId &&
      !(await this.prisma.eventAsset.findFirst({
        where: { id: dto.backgroundAssetId, kind: 'BACKGROUND' },
      }))
    )
      throw new BadRequestException('Arte de fundo inválida.');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.name + dto.role}, 0))::text`;
      const last = await tx.certificateTemplate.findFirst({
        where: { name: dto.name, role: dto.role },
        orderBy: { version: 'desc' },
      });
      const row = await tx.certificateTemplate.create({
        data: {
          name: dto.name,
          role: dto.role,
          version: (last?.version || 0) + 1,
          config: {
            heading: dto.heading,
            edition: dto.edition,
            backgroundAssetId: dto.backgroundAssetId || null,
          },
        },
      });
      await tx.eventAudit.create({
        data: {
          action: 'TEMPLATE_VERSION_CREATED',
          secretaryId,
          subjectId: row.id,
        },
      });
      return row;
    });
  }
  async templateStatus(
    id: string,
    status: 'PUBLISHED' | 'ARCHIVED',
    secretaryId: number,
  ) {
    const row = await this.prisma.certificateTemplate.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Modelo não encontrado.');
    if (status === 'PUBLISHED' && row.status === 'ARCHIVED')
      throw new ConflictException('Crie nova versão para republicar.');
    const result = await this.prisma.certificateTemplate.update({
      where: { id },
      data: { status },
    });
    await this.audit(`TEMPLATE_${status}`, secretaryId, id);
    return result;
  }
  async signer(dto: SignerDto, secretaryId: number) {
    if (
      !dto.authorized ||
      !(await this.prisma.eventAsset.findFirst({
        where: { id: dto.assetId, kind: 'SIGNATURE' },
      }))
    )
      throw new BadRequestException(
        'Confirme a autorização e envie uma assinatura válida.',
      );
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.name + (dto.course || '')}, 0))::text`;
      const previous = await tx.certificateSigner.findFirst({
        where: { name: dto.name, course: dto.course || null },
        orderBy: { version: 'desc' },
      });
      const row = await tx.certificateSigner.create({
        data: {
          name: dto.name,
          title: dto.title,
          course: dto.course,
          assetId: dto.assetId,
          authorizedAt: new Date(),
          version: (previous?.version || 0) + 1,
        },
      });
      await tx.eventAudit.create({
        data: {
          action: 'SIGNER_VERSION_CREATED',
          secretaryId,
          subjectId: row.id,
        },
      });
      return row;
    });
  }
  async archiveSigner(id: string, secretaryId: number) {
    const row = await this.prisma.certificateSigner.update({
      where: { id },
      data: { archived: true },
    });
    await this.audit('SIGNER_ARCHIVED', secretaryId, id);
    return row;
  }
  async configure(id: string, dto: EventConfigurationDto, secretaryId: number) {
    const speakerSignerIds = dto.speakerSignerIds || dto.signerIds;
    const allSignerIds = [...new Set([...dto.signerIds, ...speakerSignerIds])];
    const geoPolicy = assertGeoPolicy(dto.geoPolicy);
    if (dto.visitorsAllowed && !geoPolicy)
      throw new BadRequestException(
        'Atividades abertas a visitantes exigem localização configurada.',
      );
    if (
      !dto.signerIds.length ||
      dto.signerIds.length > 3 ||
      new Set(dto.signerIds).size !== dto.signerIds.length
    )
      throw new BadRequestException(
        'Escolha de um a três assinantes distintos.',
      );
    return this.prisma.$transaction(async (tx) => {
      // Mesma ordem de locks dos services de evento/presença.
      await tx.$queryRaw`SELECT * FROM "EventCheckpoint" WHERE "eventId" = ${id} ORDER BY "type" FOR UPDATE`;
      const events = await tx.$queryRaw<
        Event[]
      >`SELECT * FROM "Event" WHERE "id" = ${id} FOR UPDATE`;
      if (!events.length) throw new NotFoundException('Evento não encontrado.');
      if (
        events[0].seriesId &&
        events[0].seriesId !== dto.seriesId &&
        (await tx.eventParticipant.count({ where: { eventId: id } }))
      )
        throw new ConflictException(
          'Não é permitido transferir uma atividade com inscritos para outra edição.',
        );
      if (
        events[0].status !== 'SCHEDULED' ||
        (await tx.attendance.count({ where: { eventId: id } }))
      )
        throw new ConflictException('Configure antes de iniciar a atividade.');
      const series = await tx.eventSeries.findUnique({
        where: { id: dto.seriesId },
      });
      if (
        series &&
        (events[0].startsAt < series.startsAt ||
          events[0].endsAt > series.endsAt)
      )
        throw new BadRequestException(
          'A atividade deve estar dentro do período da edição.',
        );
      if (
        !series ||
        series.purgedAt ||
        !series.courses.includes(dto.organizerCourse)
      )
        throw new BadRequestException('Edição/curso inválido.');
      const signers = await tx.certificateSigner.count({
        where: { id: { in: allSignerIds }, archived: false },
      });
      if (signers !== allSignerIds.length)
        throw new BadRequestException('Assinante arquivado ou inexistente.');
      for (const [role, templateId] of [
        ['ATTENDEE', dto.attendeeTemplateId],
        ['SPEAKER', dto.speakerTemplateId],
      ])
        if (
          !(await tx.certificateTemplate.findFirst({
            where: { id: templateId, role, status: 'PUBLISHED' },
          }))
        )
          throw new BadRequestException(
            'Selecione modelos publicados para cada papel.',
          );
      const certificatePolicies = {
        ATTENDEE: {
          templateId: dto.attendeeTemplateId,
          signerIds: dto.signerIds,
        },
        SPEAKER: {
          templateId: dto.speakerTemplateId,
          signerIds: speakerSignerIds,
        },
      };
      const result = await tx.event.update({
        where: { id },
        data: {
          seriesId: dto.seriesId,
          visitorsAllowed: dto.visitorsAllowed,
          organizerCourse: dto.organizerCourse,
          promoter: dto.promoter,
          windowMinutes: 15,
          geoPolicy: geoPolicy ? { ...geoPolicy } : Prisma.DbNull,
          certificatePolicies,
        },
      });
      await tx.eventAudit.create({
        data: { action: 'EVENT_CONFIGURED', secretaryId, eventId: id },
      });
      return result;
    });
  }
  async publicSeries(slug?: string) {
    return this.prisma.eventSeries.findMany({
      where: {
        published: true,
        purgedAt: null,
        retentionAt: { gt: new Date() },
        ...(slug ? { slug } : {}),
      },
      select: {
        id: true,
        slug: true,
        title: true,
        startsAt: true,
        endsAt: true,
        retentionAt: true,
        courses: true,
        cpfRequired: true,
        events: {
          where: { visitorsAllowed: true, status: { not: 'CANCELLED' } },
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
      orderBy: { startsAt: 'desc' },
    });
  }
}
