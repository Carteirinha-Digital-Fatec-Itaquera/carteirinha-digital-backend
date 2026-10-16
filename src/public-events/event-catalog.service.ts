import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, type Event } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { EventStorageService } from './event-storage.service';
import { EventService } from '../event/event.service';
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
    @Optional() private readonly eventService?: EventService,
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
          status: dto.autoPublish ? 'PUBLISHED' : 'DRAFT',
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

  async ensureDefaultTemplates() {
    const defaults = [
      {
        name: 'XIII Semana de Tecnologia — Participante',
        role: 'ATTENDEE',
        heading: 'CERTIFICADO',
        edition: "XIII Semana de Tecnologia da Fatec Itaquera 'Professor Miguel Reale'",
      },
      {
        name: 'XIII Semana de Tecnologia — Palestrante',
        role: 'SPEAKER',
        heading: 'CERTIFICADO',
        edition: "XIII Semana de Tecnologia da Fatec Itaquera 'Professor Miguel Reale'",
      },
    ];

    for (const def of defaults) {
      const existing = await this.prisma.certificateTemplate.findFirst({
        where: { name: def.name, role: def.role },
      });
      if (!existing) {
        await this.prisma.certificateTemplate.create({
          data: {
            name: def.name,
            role: def.role,
            version: 1,
            status: 'PUBLISHED',
            config: {
              heading: def.heading,
              edition: def.edition,
              backgroundAssetId: null,
            },
          },
        });
      } else if (existing.status !== 'PUBLISHED') {
        await this.prisma.certificateTemplate.update({
          where: { id: existing.id },
          data: { status: 'PUBLISHED' },
        });
      }
    }
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
    const service = this.eventService || new EventService(this.prisma);
    return service.update(id, dto, secretaryId);
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
