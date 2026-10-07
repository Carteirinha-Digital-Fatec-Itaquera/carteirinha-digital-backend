import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PROJECT_CREDITS } from '../project-credits.data';
import { ProjectContributorLinkKind } from '@prisma/client';

export interface ImportResult {
  dryRun: boolean;
  totalConsidered: number;
  created: number;
  unchanged: number;
  preservedDivergences: number;
  details: Array<{
    slug: string;
    action: 'CREATE' | 'UNCHANGED' | 'DIVERGENCE_PRESERVED';
    reason: string;
  }>;
}

@Injectable()
export class ProjectCreditsImporter {
  private readonly logger = new Logger(ProjectCreditsImporter.name);

  constructor(private readonly prisma: PrismaService) {}

  async importCuratedCredits(dryRun = true): Promise<ImportResult> {
    const result: ImportResult = {
      dryRun,
      totalConsidered: PROJECT_CREDITS.length,
      created: 0,
      unchanged: 0,
      preservedDivergences: 0,
      details: [],
    };

    for (const item of PROJECT_CREDITS) {
      const existing = await this.prisma.projectContributor.findUnique({
        where: { slug: item.id },
        include: {
          participations: true,
          links: true,
        },
      });

      if (!existing) {
        result.created++;
        result.details.push({
          slug: item.id,
          action: 'CREATE',
          reason: 'Colaborador curado ausente no banco de dados.',
        });

        if (!dryRun) {
          const publishedSnapshot = {
            id: item.id,
            name: item.name,
            photoUrl: null,
            participations: item.participations.map((p) => ({
              semester: p.semester,
              course: null,
              roles: p.roles,
              contribution: p.contribution || null,
            })),
            contacts: item.contacts.map((c) => ({
              kind: c.kind,
              label: c.label || c.kind,
              href: c.value,
            })),
          };

          await this.prisma.$transaction(async (tx) => {
            const createdContributor = await tx.projectContributor.create({
              data: {
                id: item.id,
                slug: item.id,
                name: item.name,
                status: 'PUBLISHED',
                draftVersion: 1,
                publishedVersion: 1,
                publishedSnapshot,
                profileConfirmed: true,
                photoConfirmed: false,
                publishedAt: new Date(),
              },
            });

            for (let i = 0; i < item.participations.length; i++) {
              const part = item.participations[i];
              await tx.projectContributionParticipation.create({
                data: {
                  contributorId: createdContributor?.id || item.id,
                  semester: part.semester,
                  course: null,
                  roles: part.roles,
                  contribution: part.contribution || null,
                  confirmed: true,
                  order: i,
                },
              });
            }

            for (let i = 0; i < item.contacts.length; i++) {
              const contact = item.contacts[i];
              let linkKind: ProjectContributorLinkKind = 'EXTERNAL';
              if (contact.kind === 'github') linkKind = 'GITHUB';
              else if (contact.kind === 'linkedin') linkKind = 'LINKEDIN';
              else if (contact.kind === 'email') linkKind = 'EMAIL';

              await tx.projectContributorLink.create({
                data: {
                  contributorId: createdContributor?.id || item.id,
                  kind: linkKind,
                  label: contact.label || contact.kind,
                  url: contact.value,
                  confirmed: true,
                  order: i,
                },
              });
            }

            await tx.projectCreditAudit.create({
              data: {
                contributorId: createdContributor?.id || item.id,
                action: 'PUBLISHED',
                performedBySecretaryId: null,
                performedByName: 'SISTEMA_IMPORTADOR_INICIAL',
                metadata: {
                  source: 'CURATED_STATIC_CATALOG',
                  note: 'Importação inicial idempotente do catálogo aprovado de créditos.',
                },
                afterSnapshot: publishedSnapshot,
              },
            });
          });
        }
      } else {
        // Verifica se é idêntico ou diverge
        const nameMatches = existing.name === item.name;
        const partMatches =
          existing.participations.length === item.participations.length &&
          existing.participations.every((p) =>
            item.participations.some(
              (ip) =>
                ip.semester === p.semester &&
                ip.roles.length === p.roles.length &&
                ip.roles.every((r) => p.roles.includes(r)),
            ),
          );

        if (nameMatches && partMatches) {
          result.unchanged++;
          result.details.push({
            slug: item.id,
            action: 'UNCHANGED',
            reason: 'Registro já existente idêntico ao catálogo.',
          });
        } else {
          result.preservedDivergences++;
          result.details.push({
            slug: item.id,
            action: 'DIVERGENCE_PRESERVED',
            reason:
              'Registro já foi editado na Secretaria; preservando alterações existentes sem sobrescrever.',
          });
        }
      }
    }

    this.logger.log(
      `Importação concluída (dryRun=${dryRun}): ${result.created} criados, ${result.unchanged} inalterados, ${result.preservedDivergences} divergências preservadas.`,
    );

    return result;
  }
}
