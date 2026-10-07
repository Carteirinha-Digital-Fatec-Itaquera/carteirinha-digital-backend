import { Injectable } from '@nestjs/common';
import {
  type CuratedProjectCreditContributor,
  type CuratedProjectCreditContact,
  type ProjectCreditContact,
  type ProjectCreditContactKind,
  type ProjectCreditsResponse,
  type ProjectCreditContributor,
  type ProjectCreditParticipation,
} from './project-credits.types';
import { PROJECT_CREDITS } from './project-credits.data';

const SEMESTER_PATTERN = /^\d{4}\.[12]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINKEDIN_HOSTS = new Set(['linkedin.com', 'www.linkedin.com']);

function approvedContact(
  contact: CuratedProjectCreditContact,
): ProjectCreditContact | null {
  if (!contact.approvedForPublication || !contact.value.trim()) return null;

  if (contact.kind === 'email') {
    const email = contact.value.trim();
    return EMAIL_PATTERN.test(email)
      ? {
          kind: 'email',
          label: contact.label?.trim() || 'E-mail',
          href: `mailto:${email}`,
        }
      : null;
  }

  if (contact.kind === 'portfolio') {
    let url: URL;
    try {
      url = new URL(contact.value.trim());
    } catch {
      return null;
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return {
      kind: 'portfolio',
      label: contact.label?.trim() || 'Portfólio',
      href: url.toString(),
    };
  }

  if (contact.kind !== 'github' && contact.kind !== 'linkedin') return null;

  let url: URL;
  try {
    url = new URL(contact.value);
  } catch {
    return null;
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname === '/' ||
    (contact.kind === 'github' && url.hostname !== 'github.com') ||
    (contact.kind === 'linkedin' &&
      (!LINKEDIN_HOSTS.has(url.hostname) || !url.pathname.startsWith('/in/')))
  ) {
    return null;
  }

  if (
    contact.kind === 'github' &&
    url.pathname.split('/').filter(Boolean).length !== 1
  ) {
    return null;
  }

  const defaultLabel: Record<ProjectCreditContactKind, string> = {
    github: 'GitHub',
    linkedin: 'LinkedIn',
    portfolio: 'Portfólio',
    email: 'E-mail',
  };

  return {
    kind: contact.kind,
    label: contact.label?.trim() || defaultLabel[contact.kind],
    href: url.toString(),
  };
}

function approvedParticipation(
  participation: CuratedProjectCreditContributor['participations'][number],
): ProjectCreditParticipation | null {
  const roles = participation.roles.map((role) => role.trim()).filter(Boolean);
  if (
    !participation.approvedForPublication ||
    !SEMESTER_PATTERN.test(participation.semester) ||
    roles.length === 0
  ) {
    return null;
  }

  const contribution = participation.contribution?.trim();
  return {
    semester: participation.semester,
    roles,
    ...(contribution ? { contribution } : {}),
  };
}

function semesterOrder(semester: string): number {
  const [year, term] = semester.split('.').map(Number);
  return year * 10 + term;
}

@Injectable()
export class ProjectCreditsService {
  listPublicCredits(): ProjectCreditsResponse {
    const contributors: ProjectCreditContributor[] = PROJECT_CREDITS.filter(
      (contributor) => contributor.profileApprovedForPublication,
    )
      .flatMap((contributor) => {
        const participations = contributor.participations
          .map(approvedParticipation)
          .filter(
            (value): value is ProjectCreditParticipation => value !== null,
          )
          .sort(
            (a, b) => semesterOrder(b.semester) - semesterOrder(a.semester),
          );

        if (
          !contributor.id.trim() ||
          !contributor.name.trim() ||
          participations.length === 0
        ) {
          return [];
        }

        return [
          {
            id: contributor.id,
            name: contributor.name.trim(),
            participations,
            contacts: contributor.contacts
              .map(approvedContact)
              .filter((value): value is ProjectCreditContact => value !== null),
          },
        ];
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    return { contributors };
  }
}
