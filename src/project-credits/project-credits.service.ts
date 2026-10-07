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
import {
  normalizeAndValidateUrl,
  validateSemester,
} from './utils/url-validator';

import {
  Prisma,
  ProjectContributor,
  ProjectContributionParticipation,
  ProjectContributorLink,
  ProjectCreditAudit,
  Secretary,
} from '@prisma/client';

@Injectable()
export class ProjectCreditsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicCredits(): Promise<ProjectCreditsResponse> {
    const rows = await this.prisma.projectContributor.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { name: 'asc' },
    });
    const contributors = rows.flatMap((c) => {
      if (
        !c.publishedSnapshot ||
        typeof c.publishedSnapshot !== 'object' ||
        Array.isArray(c.publishedSnapshot)
      )
        return [];
      const snap = c.publishedSnapshot as Record<string, unknown>;
      if (
        typeof snap.name !== 'string' ||
        !Array.isArray(snap.participations) ||
        !Array.isArray(snap.contacts)
      )
        return [];
      const photo = null;
      return [
        {
          id: c.id,
          name: snap.name,
          photoUrl: photo,
          participations: snap.participations,
          contacts: snap.contacts,
        },
      ];
    });
    return { contributors };
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

    const where: Prisma.ProjectContributorWhereInput = {};
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
            select: { semester: true, roles: true },
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
        photoUrl: null,
        hasPhoto: false,
        semesters: distinctSemesters,
        roles: [...new Set(c.participations.flatMap((p) => p.roles))],
        updatedAt: c.updatedAt.toISOString(),
        publishedAt: c.publishedAt ? c.publishedAt.toISOString() : null,
      };
    });

    return { total, page, limit, items };
  }

  async getContributorAdmin(
    id: string,
  ): Promise<AdminProjectContributorDetail> {
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
      this.generateSlug(dto.name) +
        '-' +
        Math.random().toString(36).substring(2, 6);

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
          photoConfirmed: false,
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
      participations: existing.participations.map((p) => ({
        semester: p.semester,
        course: p.course,
        roles: p.roles,
        contribution: p.contribution,
        confirmed: p.confirmed,
      })),
      links: existing.links.map((l) => ({
        kind: l.kind,
        label: l.label,
        url: l.url,
        confirmed: l.confirmed,
      })),
    };

    await this.prisma.$transaction(async (tx) => {
      const nextVersion = existing.draftVersion + 1;

      await this.claimVersion(tx, id, dto.expectedVersion, {
        data: {
          name: dto.name ? dto.name.trim() : existing.name,
          profileConfirmed:
            dto.profileConfirmed !== undefined
              ? dto.profileConfirmed
              : dto.name !== undefined && dto.name.trim() !== existing.name
                ? false
                : existing.profileConfirmed,
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
    if (!existing) throw new NotFoundException('Colaborador não encontrado.');
    if (existing.status === 'ARCHIVED')
      throw new ConflictException('Restaure o colaborador antes de publicar.');
    if (!dto.profileConfirmed)
      throw new BadRequestException(
        'Confirme a autorização para divulgar o perfil.',
      );
    if (
      existing.status === 'PUBLISHED' &&
      existing.publishedVersion === existing.draftVersion &&
      [existing.draftVersion, existing.draftVersion - 1].includes(
        dto.expectedVersion,
      )
    )
      return this.getContributorAdmin(id);
    if (existing.draftVersion !== dto.expectedVersion)
      throw new ConflictException('Conflito de versão. Recarregue os dados.');
    if (
      !existing.name.trim() ||
      !existing.participations.length ||
      existing.participations.some((p) => !p.confirmed || !p.roles.length) ||
      existing.links.some((l) => !l.confirmed)
    )
      throw new BadRequestException(
        'Revise nome, participações, papéis e autorizações dos contatos antes de publicar.',
      );
    const snapshot = {
      id,
      name: existing.name,
      photoUrl: null,
      participations: existing.participations.map((p) => ({
        semester: p.semester,
        course: p.course,
        roles: p.roles,
        contribution: p.contribution,
      })),
      contacts: existing.links.map((l) => ({
        kind: l.kind.toLowerCase(),
        label: l.label,
        href: l.url,
      })),
    };
    await this.prisma.$transaction(async (tx) => {
      await this.claimVersion(tx, id, dto.expectedVersion, {
        data: {
          status: 'PUBLISHED',
          draftVersion: dto.expectedVersion + 1,
          publishedVersion: dto.expectedVersion + 1,
          publishedSnapshot: snapshot,
          publishedAt: new Date(),
          profileConfirmed: true,
        },
      });
      await tx.projectCreditAudit.create({
        data: {
          contributorId: id,
          action: 'PUBLISHED',
          performedBySecretaryId: secretary.id,
          performedByName: secretary.name,
          beforeSnapshot:
            (existing.publishedSnapshot as Prisma.InputJsonValue) ??
            Prisma.JsonNull,
          afterSnapshot: snapshot,
        },
      });
    });
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
      await this.claimVersion(tx, id, dto.expectedVersion, {
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
          metadata: {
            reason: dto.reason?.trim() || 'Arquivado pela secretaria',
          },
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
      await this.claimVersion(tx, id, dto.expectedVersion, {
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
          metadata: {
            note: 'Restaurado para rascunho sem republicação automática.',
          },
        },
      });
    });

    return this.getContributorAdmin(id);
  }

  async getAuditHistory(
    id: string,
    page = 1,
    limit = 20,
  ): Promise<{
    total: number;
    page: number;
    limit: number;
    items: AdminAuditLogItem[];
  }> {
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

  private async claimVersion(
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
    update: { data: Prisma.ProjectContributorUpdateManyMutationInput },
  ): Promise<void> {
    const result = await tx.projectContributor.updateMany({
      where: { id, draftVersion: version },
      data: update.data,
    });
    if (result.count !== 1)
      throw new ConflictException('Conflito de versão. Recarregue os dados.');
  }

  private mapToDetailDto(
    c: ProjectContributor & {
      participations: ProjectContributionParticipation[];
      links: ProjectContributorLink[];
      audits?: ProjectCreditAudit[];
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
      photoPending: false,
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
        beforeSnapshot: a.beforeSnapshot as Record<string, unknown> | null,
        afterSnapshot: a.afterSnapshot as Record<string, unknown> | null,
        metadata: a.metadata as Record<string, unknown> | null,
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
