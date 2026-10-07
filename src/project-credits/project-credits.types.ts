export type ProjectCreditContactKind =
  | 'github'
  | 'linkedin'
  | 'portfolio'
  | 'email';

export interface ProjectCreditContact {
  kind: ProjectCreditContactKind;
  label: string;
  href: string;
}

export interface ProjectCreditParticipation {
  semester: string;
  roles: string[];
  contribution?: string;
}

export interface ProjectCreditContributor {
  id: string;
  name: string;
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
  roles: string[];
  contribution?: string;
  approvedForPublication: boolean;
}

export interface CuratedProjectCreditContributor {
  id: string;
  name: string;
  profileApprovedForPublication: boolean;
  participations: CuratedProjectCreditParticipation[];
  contacts: CuratedProjectCreditContact[];
}
