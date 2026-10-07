import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  AdminAuditLogItem,
  AdminProjectContributorDetail,
  AdminProjectContributorSummary,
  ProjectCreditContactKind,
  ProjectCreditsResponse,
} from './project-credits.types';
import { CreateContributorDto } from './dto/create-contributor.dto';
import { UpdateContributorDto } from './dto/update-contributor.dto';
import { PublishContributorDto } from './dto/publish-contributor.dto';
import {
  ArchiveContributorDto,
  RestoreContributorDto,
} from './dto/archive-restore.dto';
import { AdminQueryContributorsDto } from './dto/admin-query.dto';
import { normalizeAndValidateUrl, validateSemester } from './utils/url-validator';
import { ProjectCreditsAssetService } from './services/project-credits-asset.service';
import {
  Prisma,
  ProjectContributor,
  ProjectContributorLinkKind,
  Secretary,
} from '@prisma/client';

@Injectable()
export class ProjectCreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetService: ProjectCreditsAssetService,
  ) {}

  async getPublicCredits(): Promise<ProjectCreditsResponse> {
    const contributors = await this.prisma.projectContributor.findMany({
      where: { status: 'PUBLISHED' },
      include: {
        participations: {
          where: { confirmed: true },
          orderBy: [{ order: 'asc' }, { semester: 'desc' }],
        },
        links: {
          where: { confirmed: true },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: [{ name: 'asc' }],
    });

    const mapped = contributors.map((c) => {
      if (c.publishedSnapshot && typeof c.publishedSnapshot === 'object') {
        const snap = c.publishedSnapshot as Record<string, unknown>;
        return {
          id: (snap.id as string) || c.id,
          name: (snap.name as string) || c.name,
          photoUrl: (snap.photoUrl as string | null) || null,
          participations: Array.isArray(snap.participations)
            ? snap.participations
            : [],
          contacts: Array.isArray(snap.contacts) ? snap.contacts : [],
        };
      }

      return {
        id: c.id,
        name: c.name,
        photoUrl: c.photoUrl,
        participations: c.participations.map((p) => ({
          semester: p.semester,
          course: p.course,
          roles: p.roles,
          contribution: p.contribution,
        })),
        contacts: c.links.map((l) => ({
          kind: l.kind.toLowerCase() as ProjectCreditContactKind,
          label: l.label,
          href: l.url,
        })),
      };
    });

    return { contributors: mapped };
  }

  async listContributorsAdmin(query: AdminQueryContributorsDto): Promise<{
    total: number;
    page: number;
    limit: number;
    items: AdminProjectContributorSummary[];
  }> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.q?.trim()) {
      where.name = { contains: query.q.trim(), mode: 'insensitive' };
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.semester?.trim()) {
      where.participations = {
        some: { semester: query.semester.trim() },
      };
    }

    const [total, contributors] = await Promise.all([
      this.prisma.projectContributor.count({ where }),
      this.prisma.projectContributor.findMany({
        where,
        skip,
        take: limit,
        include: {
          participations: {
            select: { semester: true },
            orderBy: { semester: 'desc' },
          },
        },
        orderBy: [{ updatedAt: 'desc' }],
      }),
    ]);

    const items: AdminProjectContributorSummary[] = contributors.map((c) => {
      const distinctSemesters = Array.from(
        new Set(c.participations.map((p) => p.semester)),
      ).sort((a, b) => b.localeCompare(a));

      const hasUnpublishedChanges =
        c.status === 'PUBLISHED' &&
        c.publishedVersion !== null &&
        c.draftVersion > c.publishedVersion;

      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        status: c.status,
        draftVersion: c.draftVersion,
        publishedVersion: c.publishedVersion,
        hasUnpublishedChanges,
        photoUrl: c.photoUrl,
        hasPhoto: Boolean(c.photoUrl || c.photoStorageKey || c.photoPendingKey),
        semesters: distinctSemesters,
        updatedAt: c.updatedAt.toISOString(),
        publishedAt: c.publishedAt ? c.publishedAt.toISOString() : null,
      };
    });

    return { total, page, limit, items };
  }

  async getContributorAdmin(id: string): Promise<AdminProjectContributorDetail> {
    const c = await this.prisma.projectContributor.findUnique({
      where: { id },
      include: {
        participations: {
          orderBy: [{ order: 'asc' }, { semester: 'desc' }],
        },
        links: {
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        },
        audits: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!c) {
      throw new NotFoundException(`Colaborador com ID "${id}" não encontrado.`);
    }

    return this.mapToDetailDto(c);
  }

  async createContributor(
    dto: CreateContributorDto,
    secretary: Secretary,
  ): Promise<AdminProjectContributorDetail> {
    const slug =
      dto.slug?.trim() ||
      this.generateSlug(dto.name) + '-' + Math.random().toString(36).substring(2, 6);

    const existingSlug = await this.prisma.projectContributor.findUnique({
      where: { slug },
    });
    if (existingSlug) {
      throw new ConflictException(
        `Já existe um colaborador cadastrado com o identificador "${slug}".`,
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const contributor = await tx.projectContributor.create({
        data: {
          slug,
          name: dto.name.trim(),
          status: 'DRAFT',
          draftVersion: 1,
          profileConfirmed: Boolean(dto.profileConfirmed),
          photoConfirmed: Boolean(dto.photoConfirmed),
        },
      });

      if (dto.participations && dto.participations.length > 0) {
        for (let i = 0; i < dto.participations.length; i++) {
          const p = dto.participations[i];
          const validSemester = validateSemester(p.semester);
          await tx.projectContributionParticipation.create({
            data: {
              contributorId: contributor.id,
              semester: validSemester,
              course: p.course?.trim() || null,
              roles: p.roles.map((r) => r.trim()).filter(Boolean),
              contribution: p.contribution?.trim() || null,
              confirmed: Boolean(p.confirmed),
              order: p.order ?? i,
            },
          });
        }
      }

      if (dto.links && dto.links.length > 0) {
        for (let i = 0; i < dto.links.length; i++) {
          const l = dto.links[i];
          const validated = normalizeAndValidateUrl(
            l.kind.toLowerCase() as ProjectCreditContactKind,
            l.url,
            l.label,
          );
          await tx.projectContributorLink.create({
            data: {
              contributorId: contributor.id,
              kind: l.kind,
              label: validated.label,
              url: validated.url,
              confirmed: Boolean(l.confirmed),
              order: l.order ?? i,
            },
          });
        }
      }

      await tx.projectCreditAudit.create({
        data: {
          contributorId: contributor.id,
          action: 'CREATED',
          performedBySecretaryId: secretary.id,
          performedByName: secretary.name,
          afterSnapshot: {
            name: contributor.name,
            status: contributor.status,
            participationsCount: dto.participations?.length || 0,
            linksCount: dto.links?.length || 0,
          },
        },
      });

      return contributor;
    });

    return this.getContributorAdmin(created.id);
  }

  async updateContributor(
    id: string,
    dto: UpdateContributorDto,
    secretary: Secretary,
  ): Promise<AdminProjectContributorDetail> {
    const existing = await this.prisma.projectContributor.findUnique({
      where: { id },
      include: {
        participations: true,
        links: true,
      },
    });

    if (!existing) {
      throw new NotFoundException(`Colaborador com ID "${id}" não encontrado.`);
    }

    if (existing.draftVersion !== dto.expectedVersion) {
      throw new ConflictException(
        `Conflito de versão: o colaborador foi modificado por outro usuário (versão atual: ${existing.draftVersion}, esperada: ${dto.expectedVersion}). Recarregue para atualizar.`,
      );
    }

    const beforeSnapshot = {
      name: existing.name,
      draftVersion: existing.draftVersion,
      profileConfirmed: existing.profileConfirmed,
      photoConfirmed: existing.photoConfirmed,
      participations: existing.participations,
      links: existing.links,
    };

    await this.prisma.$transaction(async (tx) => {
      const nextVersion = existing.draftVersion + 1;

      await tx.projectContributor.update({
        where: { id },
        data: {
          name: dto.name ? dto.name.trim() : existing.name,
          profileConfirmed:
            dto.profileConfirmed !== undefined
              ? dto.profileConfirmed
              : existing.profileConfirmed,
          photoConfirmed:
            dto.photoConfirmed !== undefined
              ? dto.photoConfirmed
              : existing.photoConfirmed,
          draftVersion: nextVersion,
        },
      });

      if (dto.participations !== undefined) {
        await tx.projectContributionParticipation.deleteMany({
          where: { contributorId: id },
        });

        for (let i = 0; i < dto.participations.length; i++) {
          const p = dto.participations[i];
          const validSemester = validateSemester(p.semester);
          await tx.projectContributionParticipation.create({
            data: {
              contributorId: id,
              semester: validSemester,
              course: p.course?.trim() || null,
              roles: p.roles.map((r) => r.trim()).filter(Boolean),
              contribution: p.contribution?.trim() || null,
              confirmed: Boolean(p.confirmed),
              order: p.order ?? i,
            },
          });
        }
      }

      if (dto.links !== undefined) {
        await tx.projectContributorLink.deleteMany({
          where: { contributorId: id },
        });

        for (let i = 0; i < dto.links.length; i++) {
          const l = dto.links[i];
          const validated = normalizeAndValidateUrl(
            l.kind.toLowerCase() as ProjectCreditContactKind,
            l.url,
            l.label,
          );
          await tx.projectContributorLink.create({
            data: {
              contributorId: id,
              kind: l.kind,
              label: validated.label,
              url: validated.url,
              confirmed: Boolean(l.confirmed),
              order: l.order ?? i,
            },
          });
        }
      }

      await tx.projectCreditAudit.create({
        data: {
          contributorId: id,
          action: 'DRAFT_SAVED',
          performedBySecretaryId: secretary.id,
          performedByName: secretary.name,
          beforeSnapshot,
          afterSnapshot: {
            name: dto.name || existing.name,
            draftVersion: nextVersion,
            participationsCount: dto.participations?.length,
            linksCount: dto.links?.length,
          },
        },
      });
    });

    return this.getContributorAdmin(id);
  }

  async publishContributor(
    id: string,
    dto: PublishContributorDto,
    secretary: Secretary,
  ): Promise<AdminProjectContributorDetail> {
    const existing = await this.prisma.projectContributor.findUnique({
      where: { id },
      include: {
        participations: { orderBy: [{ order: 'asc' }, { semester: 'desc' }] },
        links: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
      },
    });

    if (!existing) {
      throw new NotFoundException(`Colaborador com ID "${id}" não encontrado.`);
    }

    if (existing.draftVersion !== dto.expectedVersion) {
      throw new ConflictException(
        `Conflito de versão: o colaborador foi modificado por outro usuário (versão atual: ${existing.draftVersion}, esperada: ${dto.expectedVersion}).`,
      );
    }

    if (!dto.profileConfirmed) {
      throw new BadRequestException(
        'A autorização expressa para divulgação dos dados do colaborador é obrigatória para publicar.',
      );
    }

    if (!existing.name.trim()) {
      throw new BadRequestException('O nome do colaborador não pode ser vazio.');
    }

    if (existing.participations.length === 0) {
      throw new BadRequestException(
        'O colaborador deve possuir pelo menos uma participação por semestre para ser publicado.',
      );
    }

    const unconfirmedParticipation = existing.participations.find(
      (p) => !p.confirmed,
    );
    if (unconfirmedParticipation) {
      throw new BadRequestException(
        `A participação do semestre "${unconfirmedParticipation.semester}" precisa ser confirmada antes da publicação.`,
      );
    }

    const unconfirmedLink = existing.links.find((l) => !l.confirmed);
    if (unconfirmedLink) {
      throw new BadRequestException(
        `O link "${unconfirmedLink.label}" precisa ser confirmado antes da publicação.`,
      );
    }

    let publicPhotoUrl = existing.photoUrl;
    let oldStorageKeyToCleanup: string | null = null;

    if (existing.photoPendingKey) {
      publicPhotoUrl = this.assetService.getPrivateDownloadUrl(
        existing.photoPendingKey,
      );
      if (existing.photoStorageKey && existing.photoStorageKey !== existing.photoPendingKey) {
        oldStorageKeyToCleanup = existing.photoStorageKey;
      }
    }

    const nextVersion = existing.draftVersion + 1;

    const publishedSnapshot = {
      id: existing.id,
      name: existing.name,
      photoUrl: publicPhotoUrl,
      participations: existing.participations.map((p) => ({
        semester: p.semester,
        course: p.course || null,
        roles: p.roles,
        contribution: p.contribution || null,
      })),
      contacts: existing.links.map((l) => ({
        kind: l.kind.toLowerCase() as ProjectCreditContactKind,
        label: l.label,
        href: l.url,
      })),
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.projectContributor.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          draftVersion: nextVersion,
          publishedVersion: nextVersion,
          publishedSnapshot,
          publishedAt: new Date(),
          profileConfirmed: true,
          photoConfirmed: Boolean(dto.photoConfirmed ?? existing.photoConfirmed),
          photoUrl: publicPhotoUrl,
          photoStorageKey: existing.photoPendingKey || existing.photoStorageKey,
          photoPendingKey: null,
        },
      });

      await tx.projectCreditAudit.create({
        data: {
          contributorId: id,
          action: 'PUBLISHED',
          performedBySecretaryId: secretary.id,
          performedByName: secretary.name,
          beforeSnapshot:
            (existing.publishedSnapshot as unknown as Prisma.InputJsonValue) ??
            Prisma.JsonNull,
          afterSnapshot: publishedSnapshot as unknown as Prisma.InputJsonValue,
        },
      });
    });

    if (oldStorageKeyToCleanup) {
      await this.assetService.destroyAsset(oldStorageKeyToCleanup);
    }

    return this.getContributorAdmin(id);
  }

  async archiveContributor(
    id: string,
    dto: ArchiveContributorDto,
    secretary: Secretary,
  ): Promise<AdminProjectContributorDetail> {
    const existing = await this.prisma.projectContributor.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Colaborador com ID "${id}" não encontrado.`);
    }

    if (existing.draftVersion !== dto.expectedVersion) {
      throw new ConflictException(
        `Conflito de versão: o colaborador foi modificado por outro usuário (versão atual: ${existing.draftVersion}, esperada: ${dto.expectedVersion}).`,
      );
    }

    const nextVersion = existing.draftVersion + 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.projectContributor.update({
        where: { id },
        data: {
          status: 'ARCHIVED',
          archiveReason: dto.reason?.trim() || null,
          archivedAt: new Date(),
          draftVersion: nextVersion,
        },
      });

      await tx.projectCreditAudit.create({
        data: {
          contributorId: id,
          action: 'ARCHIVED',
          performedBySecretaryId: secretary.id,
          performedByName: secretary.name,
          metadata: { reason: dto.reason?.trim() || 'Arquivado pela secretaria' },
        },
      });
    });

    return this.getContributorAdmin(id);
  }

  async restoreContributor(
    id: string,
    dto: RestoreContributorDto,
    secretary: Secretary,
  ): Promise<AdminProjectContributorDetail> {
    const existing = await this.prisma.projectContributor.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Colaborador com ID "${id}" não encontrado.`);
    }

    if (existing.draftVersion !== dto.expectedVersion) {
      throw new ConflictException(
        `Conflito de versão: o colaborador foi modificado por outro usuário (versão atual: ${existing.draftVersion}, esperada: ${dto.expectedVersion}).`,
      );
    }

    const nextVersion = existing.draftVersion + 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.projectContributor.update({
        where: { id },
        data: {
          status: 'DRAFT',
          archiveReason: null,
          archivedAt: null,
          draftVersion: nextVersion,
        },
      });

      await tx.projectCreditAudit.create({
        data: {
          contributorId: id,
          action: 'RESTORED',
          performedBySecretaryId: secretary.id,
          performedByName: secretary.name,
          metadata: { note: 'Restaurado para rascunho sem republicação automática.' },
        },
      });
    });

    return this.getContributorAdmin(id);
  }

  async uploadPhoto(
    id: string,
    file: Express.Multer.File,
    expectedVersion: number,
    secretary: Secretary,
  ): Promise<AdminProjectContributorDetail> {
    const existing = await this.prisma.projectContributor.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Colaborador com ID "${id}" não encontrado.`);
    }

    if (existing.draftVersion !== expectedVersion) {
      throw new ConflictException(
        `Conflito de versão ao enviar foto (versão atual: ${existing.draftVersion}, esperada: ${expectedVersion}).`,
      );
    }

    const processed = await this.assetService.processPhoto(file.buffer);
    const { storageKey } = await this.assetService.uploadDraftPhoto(
      id,
      existing.draftVersion,
      processed.buffer,
    );

    const oldPending = existing.photoPendingKey;
    const nextVersion = existing.draftVersion + 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.projectContributor.update({
        where: { id },
        data: {
          photoPendingKey: storageKey,
          photoConfirmed: true,
          draftVersion: nextVersion,
        },
      });

      await tx.projectCreditAudit.create({
        data: {
          contributorId: id,
          action: 'PHOTO_REPLACED',
          performedBySecretaryId: secretary.id,
          performedByName: secretary.name,
          metadata: { newStorageKey: storageKey },
        },
      });
    });

    if (oldPending && oldPending !== storageKey) {
      await this.assetService.destroyAsset(oldPending);
    }

    return this.getContributorAdmin(id);
  }

  async deletePhoto(
    id: string,
    expectedVersion: number,
    secretary: Secretary,
  ): Promise<AdminProjectContributorDetail> {
    const existing = await this.prisma.projectContributor.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Colaborador com ID "${id}" não encontrado.`);
    }

    if (existing.draftVersion !== expectedVersion) {
      throw new ConflictException(
        `Conflito de versão ao remover foto (versão atual: ${existing.draftVersion}, esperada: ${expectedVersion}).`,
      );
    }

    const oldPending = existing.photoPendingKey;
    const nextVersion = existing.draftVersion + 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.projectContributor.update({
        where: { id },
        data: {
          photoPendingKey: null,
          photoConfirmed: false,
          draftVersion: nextVersion,
        },
      });

      await tx.projectCreditAudit.create({
        data: {
          contributorId: id,
          action: 'PHOTO_REMOVED',
          performedBySecretaryId: secretary.id,
          performedByName: secretary.name,
        },
      });
    });

    if (oldPending) {
      await this.assetService.destroyAsset(oldPending);
    }

    return this.getContributorAdmin(id);
  }

  async getPhotoPreview(id: string): Promise<{ url: string }> {
    const existing = await this.prisma.projectContributor.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Colaborador com ID "${id}" não encontrado.`);
    }

    const key = existing.photoPendingKey || existing.photoStorageKey;
    if (!key) {
      throw new NotFoundException('Colaborador não possui foto cadastrada.');
    }

    return {
      url: this.assetService.getPrivateDownloadUrl(key),
    };
  }

  async getAuditHistory(
    id: string,
    page = 1,
    limit = 20,
  ): Promise<{ total: number; page: number; limit: number; items: AdminAuditLogItem[] }> {
    const pageNum = Math.max(1, Number(page) || 1);
    const take = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (pageNum - 1) * take;

    const [total, audits] = await Promise.all([
      this.prisma.projectCreditAudit.count({ where: { contributorId: id } }),
      this.prisma.projectCreditAudit.findMany({
        where: { contributorId: id },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const items: AdminAuditLogItem[] = audits.map((a) => ({
      id: a.id,
      action: a.action,
      performedBySecretaryId: a.performedBySecretaryId,
      performedByName: a.performedByName,
      beforeSnapshot: a.beforeSnapshot as Record<string, unknown> | null,
      afterSnapshot: a.afterSnapshot as Record<string, unknown> | null,
      metadata: a.metadata as Record<string, unknown> | null,
      createdAt: a.createdAt.toISOString(),
    }));

    return { total, page: pageNum, limit: take, items };
  }

  private mapToDetailDto(
    c: ProjectContributor & {
      participations: any[];
      links: any[];
      audits?: any[];
    },
  ): AdminProjectContributorDetail {
    const hasUnpublishedChanges =
      c.status === 'PUBLISHED' &&
      c.publishedVersion !== null &&
      c.draftVersion > c.publishedVersion;

    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      status: c.status,
      draftVersion: c.draftVersion,
      publishedVersion: c.publishedVersion,
      hasUnpublishedChanges,
      photoUrl: c.photoUrl,
      photoPending: Boolean(c.photoPendingKey),
      photoConfirmed: c.photoConfirmed,
      profileConfirmed: c.profileConfirmed,
      archiveReason: c.archiveReason,
      archivedAt: c.archivedAt ? c.archivedAt.toISOString() : null,
      publishedAt: c.publishedAt ? c.publishedAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      participations: c.participations.map((p) => ({
        id: p.id,
        semester: p.semester,
        course: p.course,
        roles: p.roles,
        contribution: p.contribution,
        confirmed: p.confirmed,
        order: p.order,
      })),
      links: c.links.map((l) => ({
        id: l.id,
        kind: l.kind.toLowerCase() as ProjectCreditContactKind,
        label: l.label,
        url: l.url,
        order: l.order,
        confirmed: l.confirmed,
      })),
      recentAudits: c.audits?.map((a) => ({
        id: a.id,
        action: a.action,
        performedBySecretaryId: a.performedBySecretaryId,
        performedByName: a.performedByName,
        beforeSnapshot: a.beforeSnapshot,
        afterSnapshot: a.afterSnapshot,
        metadata: a.metadata,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
