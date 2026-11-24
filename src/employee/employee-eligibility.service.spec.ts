import { EmployeeEligibilityService } from './employee-eligibility.service';

describe('EmployeeEligibilityService', () => {
  const service = new EmployeeEligibilityService();
  const baseEmployee = {
    accountStatus: 'ACTIVE' as const,
    archivedAt: null,
    admissionDate: new Date('2024-02-01T00:00:00.000Z'),
  };
  const approvedPhoto = [
    {
      id: 'photo-1',
      reviewStatus: 'APPROVED' as const,
      processingState: 'READY',
      currentApproved: true,
      currentPending: false,
    },
  ];

  it('retorna INDETERMINATE quando há função sem validUntil e outra com prazo', () => {
    const now = new Date('2026-11-17T15:00:00.000Z');
    const result = service.evaluate(
      baseEmployee,
      [
        {
          id: 'a1',
          title: 'Docente',
          active: true,
          archivedAt: null,
          startsOn: null,
          validUntil: null,
        },
        {
          id: 'a2',
          title: 'Coordenador de DSM',
          active: true,
          archivedAt: null,
          startsOn: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: new Date('2026-12-20T00:00:00.000Z'),
        },
      ],
      approvedPhoto,
      now,
    );

    expect(result.valid).toBe(true);
    expect(result.validityKind).toBe('INDETERMINATE');
    expect(result.validUntil).toBeNull();
    expect(result.activeAssignments).toHaveLength(2);
  });

  it('usa a maior data de vencimento entre funções com prazo e respeita fim inclusivo em America/Sao_Paulo', () => {
    // 2026-11-30 23:30:00 BRT = 2026-12-01 02:30:00 UTC
    const now = new Date('2026-12-01T02:30:00.000Z');
    const result = service.evaluate(
      baseEmployee,
      [
        {
          id: 'a1',
          title: 'Função A',
          active: true,
          archivedAt: null,
          startsOn: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: new Date('2026-11-30T00:00:00.000Z'),
        },
        {
          id: 'a2',
          title: 'Função B',
          active: true,
          archivedAt: null,
          startsOn: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: new Date('2026-12-15T00:00:00.000Z'),
        },
      ],
      approvedPhoto,
      now,
    );

    expect(result.valid).toBe(true);
    expect(result.validityKind).toBe('UNTIL_DATE');
    expect(result.validUntil).toBe('2026-12-15');
    expect(result.activeAssignments).toHaveLength(2);
  });

  it('marca função futura como FUTURE e nenhuma função ativa como NO_ACTIVE_ASSIGNMENT', () => {
    const now = new Date('2026-11-17T15:00:00.000Z');
    const result = service.evaluate(
      baseEmployee,
      [
        {
          id: 'a1',
          title: 'Docente Futuro',
          active: true,
          archivedAt: null,
          startsOn: new Date('2026-12-01T00:00:00.000Z'),
          validUntil: null,
        },
      ],
      approvedPhoto,
      now,
    );

    expect(result.employmentEligible).toBe(false);
    expect(result.cardEligible).toBe(false);
    expect(result.validityKind).toBe('NO_ACTIVE_ASSIGNMENT');
    expect(result.reasonCode).toBe('NO_ACTIVE_ASSIGNMENT');
  });

  it('foto pendente bloqueia carteirinha válida mas mantém employmentEligible=true', () => {
    const now = new Date('2026-11-17T15:00:00.000Z');
    const result = service.evaluate(
      baseEmployee,
      [
        {
          id: 'a1',
          title: 'Docente',
          active: true,
          archivedAt: null,
          startsOn: null,
          validUntil: null,
        },
      ],
      [
        {
          id: 'p1',
          reviewStatus: 'PENDING',
          processingState: 'READY',
          currentApproved: false,
          currentPending: true,
        },
      ],
      now,
    );

    expect(result.accountAllowed).toBe(true);
    expect(result.employmentEligible).toBe(true);
    expect(result.cardEligible).toBe(false);
    expect(result.reasonCode).toBe('PHOTO_PENDING');
  });

  it('conta bloqueada impede elegibilidade mesmo com função ativa e foto aprovada', () => {
    const now = new Date('2026-11-17T15:00:00.000Z');
    const result = service.evaluate(
      { ...baseEmployee, accountStatus: 'BLOCKED' },
      [
        {
          id: 'a1',
          title: 'Docente',
          active: true,
          archivedAt: null,
          startsOn: null,
          validUntil: null,
        },
      ],
      approvedPhoto,
      now,
    );

    expect(result.accountAllowed).toBe(false);
    expect(result.employmentEligible).toBe(false);
    expect(result.cardEligible).toBe(false);
    expect(result.reasonCode).toBe('ACCOUNT_BLOCKED');
  });

  it.each([
    [
      'admissão futura',
      { admissionDate: new Date('2027-01-01') },
      'ADMISSION_FUTURE',
    ],
    [
      'conta arquivada',
      { accountStatus: 'ARCHIVED' as const },
      'ACCOUNT_ARCHIVED',
    ],
    [
      'arquivamento registrado',
      { archivedAt: new Date('2026-01-01') },
      'ACCOUNT_ARCHIVED',
    ],
  ])(
    'preserva bloqueio por %s após aprovação da foto',
    (_label, changes, reason) => {
      const result = service.evaluate(
        { ...baseEmployee, ...changes },
        [
          {
            id: 'vigente',
            title: 'Docente',
            active: true,
            archivedAt: null,
            startsOn: null,
            validUntil: null,
          },
        ],
        approvedPhoto,
        new Date('2026-11-24T15:00:00Z'),
      );
      expect(result.valid).toBe(false);
      expect(result.reasonCode).toBe(reason);
    },
  );

  it.each([
    { active: false, archivedAt: null, validUntil: null },
    { active: true, archivedAt: new Date('2026-01-01'), validUntil: null },
    { active: true, archivedAt: null, validUntil: new Date('2026-11-23') },
  ])('não libera QR sem função vigente: %j', (changes) => {
    const result = service.evaluate(
      baseEmployee,
      [{ id: 'encerrada', title: 'Docente', startsOn: null, ...changes }],
      approvedPhoto,
      new Date('2026-11-24T15:00:00Z'),
    );
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe('NO_ACTIVE_ASSIGNMENT');
  });
});
