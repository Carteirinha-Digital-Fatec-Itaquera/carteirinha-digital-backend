export type ProjectCreditContactKind =
  | 'github'
  | 'linkedin'
  | 'portfolio'
  | 'email'
  | 'external';

export interface ProjectCreditContact {
  kind: ProjectCreditContactKind;
  label: string;
  href: string;
}

export interface ProjectCreditParticipation {
  semester: string;
  course?: string | null;
  roles: string[];
  contribution?: string | null;
}

export interface ProjectCreditContributor {
  id: string;
  name: string;
  photoUrl?: string | null;
  participations: ProjectCreditParticipation[];
  contacts: ProjectCreditContact[];
}

export interface ProjectCreditsResponse {
  contributors: ProjectCreditContributor[];
}

export interface CuratedProjectCreditContact {
  kind: ProjectCreditContactKind;
  value: string;
  label?: string;
  approvedForPublication: boolean;
}

export interface CuratedProjectCreditParticipation {
  semester: string;
  course?: string | null;
  roles: string[];
  contribution?: string | null;
  approvedForPublication: boolean;
}

export interface CuratedProjectCreditContributor {
  id: string;
  name: string;
  photoUrl?: string | null;
  profileApprovedForPublication: boolean;
  participations: CuratedProjectCreditParticipation[];
  contacts: CuratedProjectCreditContact[];
}

export type ContributorStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface AdminProjectParticipation {
  id?: string;
  semester: string;
  course?: string | null;
  roles: string[];
  contribution?: string | null;
  confirmed: boolean;
  order?: number;
}

export interface AdminProjectLink {
  id?: string;
  kind: ProjectCreditContactKind;
  label: string;
  url: string;
  order?: number;
  confirmed: boolean;
}

export interface AdminProjectContributorSummary {
  id: string;
  slug: string;
  name: string;
  status: ContributorStatus;
  draftVersion: number;
  publishedVersion?: number | null;
  hasUnpublishedChanges: boolean;
  photoUrl?: string | null;
  hasPhoto: boolean;
  semesters: string[];
  roles: string[];
  updatedAt: string;
  publishedAt?: string | null;
}

export interface AdminProjectContributorDetail {
  id: string;
  slug: string;
  name: string;
  status: ContributorStatus;
  draftVersion: number;
  publishedVersion?: number | null;
  hasUnpublishedChanges: boolean;
  photoUrl?: string | null;
  photoPending: boolean;
  photoConfirmed: boolean;
  profileConfirmed: boolean;
  archiveReason?: string | null;
  archivedAt?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  participations: AdminProjectParticipation[];
  links: AdminProjectLink[];
  recentAudits?: AdminAuditLogItem[];
}

export interface AdminAuditLogItem {
  id: string;
  action: string;
  performedBySecretaryId?: number | null;
  performedByName?: string | null;
  beforeSnapshot?: Record<string, unknown> | null;
  afterSnapshot?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}
