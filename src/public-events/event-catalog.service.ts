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
  UpdateTemplateDto,
  UpdateSignerDto,
} from './public-events.dto';

export interface TemplateConfig {
  wordingVersion?: 'LECTURE_LISTENER_2026' | 'LEGACY';
  textColor?: string;
  heading: string;
  edition: string;
  backgroundAssetId?: string;
  design?: 'TECHNOLOGY_BLUE_2026' | 'TECHNOLOGY_BLUE_2026_DARK';
  attendeeAction?: string;
  speakerAction?: string;
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
        cpfRequired: true,
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
            ...(dto.wordingVersion
              ? { wordingVersion: dto.wordingVersion }
              : {}),
            ...(dto.textColor ? { textColor: dto.textColor } : {}),
            edition: dto.edition,
            backgroundAssetId: dto.backgroundAssetId || null,
            ...(dto.design ? { design: dto.design } : {}),
            ...(dto.attendeeAction
              ? { attendeeAction: dto.attendeeAction }
              : {}),
            ...(dto.speakerAction ? { speakerAction: dto.speakerAction } : {}),
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
        edition:
          "XIII Semana de Tecnologia da Fatec Itaquera 'Professor Miguel Reale'",
      },
      {
        name: 'XIII Semana de Tecnologia — Palestrante',
        role: 'SPEAKER',
        heading: 'CERTIFICADO',
        edition:
          "XIII Semana de Tecnologia da Fatec Itaquera 'Professor Miguel Reale'",
      },
    ];

    defaults.push(
      {
        name: 'XIII Semana de Tecnologia 2026 — Azul Circuitos — Participante',
        role: 'ATTENDEE',
        heading: 'CERTIFICADO',
        edition:
          "XIII Semana de Tecnologia da Fatec Itaquera 'Professor Miguel Reale'",
      },
      {
        name: 'XIII Semana de Tecnologia 2026 — Azul Circuitos — Palestrante',
        role: 'SPEAKER',
        heading: 'CERTIFICADO',
        edition:
          "XIII Semana de Tecnologia da Fatec Itaquera 'Professor Miguel Reale'",
      },
    );

    defaults.push(
      ...defaults
        .filter(
          (def) =>
            def.name.includes('Azul Circuitos') ||
            def.name.includes('Azul Integral CPS'),
        )
        .map((def) => ({
          ...def,
          name: def.name.replace('Azul Circuitos', 'Azul Integral CPS'),
        })),
    );

    // Only the approved final design is offered for new events.
    for (const def of defaults.filter((def) =>
      def.name.includes('Azul Integral CPS'),
    )) {
      const existing = await this.prisma.certificateTemplate.findFirst({
        where: {
          role: def.role,
          config: { path: ['design'], equals: 'TECHNOLOGY_BLUE_2026_DARK' },
        },
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
              ...(def.name.includes('Azul Circuitos') ||
              def.name.includes('Azul Integral CPS')
                ? {
                    design: def.name.includes('Azul Integral CPS')
                      ? 'TECHNOLOGY_BLUE_2026_DARK'
                      : 'TECHNOLOGY_BLUE_2026',
                    attendeeAction: 'participou da atividade',
                    wordingVersion: 'LECTURE_LISTENER_2026',
                    speakerAction: 'ministrou a atividade intitulada',
                  }
                : {}),
            },
          },
        });
      }
    }
  }

  async updateTemplate(
    id: string,
    dto: UpdateTemplateDto,
    secretaryId: number,
  ) {
    if (
      dto.backgroundAssetId &&
      !(await this.prisma.eventAsset.findFirst({
        where: { id: dto.backgroundAssetId, kind: 'BACKGROUND' },
      }))
    )
      throw new BadRequestException('Arte de fundo inválida.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await tx.certificateTemplate.findUnique({
          where: { id },
        });
        if (!before) throw new NotFoundException('Modelo não encontrado.');
        if (before.role !== dto.role)
          throw new ConflictException(
            'O papel do modelo não pode ser alterado. Cadastre outro modelo.',
          );
        const oldConfig = before.config as unknown as TemplateConfig;
        const config = {
          ...oldConfig,
          heading: dto.heading,
          ...(dto.wordingVersion ? { wordingVersion: dto.wordingVersion } : {}),
          ...(dto.textColor ? { textColor: dto.textColor } : {}),
          edition: dto.edition,
          ...(dto.backgroundAssetId
            ? { backgroundAssetId: dto.backgroundAssetId }
            : {}),
          ...(dto.design ? { design: dto.design } : {}),
          ...(dto.attendeeAction !== undefined
            ? { attendeeAction: dto.attendeeAction }
            : {}),
          ...(dto.speakerAction !== undefined
            ? { speakerAction: dto.speakerAction }
            : {}),
        };
        const result = await tx.certificateTemplate.updateMany({
          where: {
            id,
            version: dto.expectedVersion,
            status: { not: 'ARCHIVED' },
          },
          data: {
            name: dto.name,
            config,
            version: { increment: 1 },
          },
        });
        if (result.count !== 1)
          throw new ConflictException(
            'O modelo foi alterado ou excluído. Atualize a lista antes de editar.',
          );
        const after = await tx.certificateTemplate.findUniqueOrThrow({
          where: { id },
        });
        await tx.eventAudit.create({
          data: {
            action: 'TEMPLATE_UPDATED',
            subjectId: id,
            secretaryId,
            reason: JSON.stringify({ before, after }),
          },
        });
        return after;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'Já existe outra versão com esse nome. Escolha um nome diferente.',
        );
      throw error;
    }
  }

  async updateSigner(id: string, dto: UpdateSignerDto, secretaryId: number) {
    dto.name = dto.name.trim();
    dto.title = dto.title.trim();
    if (dto.name.length < 3 || dto.title.length < 3)
      throw new BadRequestException(
        'Preencha os campos obrigatórios com pelo menos três caracteres.',
      );
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
      const before = await tx.certificateSigner.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Assinatura não encontrada.');
      const result = await tx.certificateSigner.updateMany({
        where: { id, version: dto.expectedVersion, archived: false },
        data: {
          name: dto.name,
          title: dto.title,
          course: dto.course || null,
          assetId: dto.assetId,
          authorizedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1)
        throw new ConflictException(
          'A assinatura foi alterada ou excluída. Atualize a lista antes de editar.',
        );
      const after = await tx.certificateSigner.findUniqueOrThrow({
        where: { id },
      });
      await tx.eventAudit.create({
        data: {
          action: 'SIGNER_UPDATED',
          subjectId: id,
          secretaryId,
          reason: JSON.stringify({ before, after }),
        },
      });
      return after;
    });
  }

  async deleteCatalogItem(
    kind: 'templates' | 'signers',
    id: string,
    expectedVersion: number,
    secretaryId: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const result =
        kind === 'templates'
          ? await tx.certificateTemplate.updateMany({
              where: {
                id,
                version: expectedVersion,
                status: { not: 'ARCHIVED' },
              },
              data: { status: 'ARCHIVED', version: { increment: 1 } },
            })
          : await tx.certificateSigner.updateMany({
              where: { id, version: expectedVersion, archived: false },
              data: { archived: true, version: { increment: 1 } },
            });
      if (result.count !== 1) {
        const found =
          kind === 'templates'
            ? await tx.certificateTemplate.findUnique({ where: { id } })
            : await tx.certificateSigner.findUnique({ where: { id } });
        if (!found) throw new NotFoundException('Cadastro não encontrado.');
        throw new ConflictException(
          'O cadastro foi alterado ou já excluído. Atualize a lista.',
        );
      }
      await tx.eventAudit.create({
        data: {
          action:
            kind === 'templates' ? 'TEMPLATE_ARCHIVED' : 'SIGNER_ARCHIVED',
          subjectId: id,
          secretaryId,
        },
      });
      return { success: true };
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
    const service = this.eventService || new EventService(this.prisma);
    return service.update(id, dto, secretaryId);
  }
  async publicSeries(slug?: string) {
    return this.prisma.eventSeries.findMany({
      where: {
        published: true,
        purgedAt: null,
        retentionAt: { gt: new Date() },
        events: {
          some: { visitorsAllowed: true, status: { not: 'CANCELLED' } },
        },
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
            status: true,
          },
        },
      },
      orderBy: { startsAt: 'desc' },
    });
  }
}
