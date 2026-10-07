import type { CuratedProjectCreditContributor } from './project-credits.types';

/**
 * Curated, version-controlled project history.
 *
 * Add a person or participation only after the project coordinator has
 * confirmed the name, semester and contribution with the contributor.
 * Contacts require the contributor's explicit approval for public display.
 * Keep only independently validated and approved names, contributions and links here.
 * The historical roster is still incomplete until the project coordinator confirms it.
 */
export const PROJECT_CREDITS: CuratedProjectCreditContributor[] = [
  {
    id: 'wellingtonspdev',
    name: 'Wellington Siqueira Porto',
    profileApprovedForPublication: true,
    participations: [
      {
        semester: '2026.2',
        roles: ['Desenvolvimento do projeto'],
        approvedForPublication: true,
      },
    ],
    contacts: [
      {
        kind: 'linkedin',
        value: 'https://www.linkedin.com/in/wellingtonsp-dev',
        label: 'LinkedIn',
        approvedForPublication: true,
      },
      {
        kind: 'github',
        value: 'https://github.com/wellingtonspdev',
        label: 'GitHub',
        approvedForPublication: true,
      },
      {
        kind: 'portfolio',
        value: 'https://wellingtonsp.uk/',
        label: 'Portfólio',
        approvedForPublication: true,
      },
    ],
  },
];
