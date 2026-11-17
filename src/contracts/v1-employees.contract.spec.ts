import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  EmployeeErrorEnvelope,
  EmployeeImportBatchView,
  EmployeeOfflineReceiptView,
  EmployeeProfileView,
  PublicEmployeeVerificationInvalid,
  PublicEmployeeVerificationValid,
} from './v1-employees.types';

interface EmployeeFixtures {
  withoutRegistration: EmployeeProfileView;
  multipleAssignmentsWithExpiry: EmployeeProfileView;
  pendingPhoto: EmployeeProfileView;
  expiredAssignments: EmployeeProfileView;
  blockedAccount: EmployeeProfileView;
  publicVerificationValid: PublicEmployeeVerificationValid;
  publicVerificationBlocked: PublicEmployeeVerificationInvalid;
  versionConflictError: EmployeeErrorEnvelope;
  partialImportBatch: EmployeeImportBatchView;
  lostOfflineReceipt: EmployeeOfflineReceiptView;
}

describe('Contrato V1 de funcionários', () => {
  const fixtures: EmployeeFixtures = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'employees.fixture.json'), 'utf8'),
  ) as EmployeeFixtures;

  const openapi = JSON.parse(
    readFileSync(join(__dirname, 'v1-employees.openapi.json'), 'utf8'),
  ) as { openapi: string; paths: Record<string, unknown> };

  it('valida fixtures de sem matrícula, múltiplas funções, vencimento, foto pendente e conta bloqueada', () => {
    expect(fixtures.withoutRegistration.registrationNumber).toBeNull();
    expect(fixtures.withoutRegistration.credential.valid).toBe(true);
    expect(fixtures.withoutRegistration.credential.validityKind).toBe(
      'INDETERMINATE',
    );

    expect(fixtures.multipleAssignmentsWithExpiry.assignments).toHaveLength(2);
    expect(fixtures.multipleAssignmentsWithExpiry.credential.validUntil).toBe(
      '2026-12-31',
    );
    expect(fixtures.multipleAssignmentsWithExpiry.displayName).toBe(
      'Nome Social Demonstracao',
    );

    expect(fixtures.pendingPhoto.credential.valid).toBe(false);
    expect(fixtures.pendingPhoto.credential.reasonCode).toBe('PHOTO_PENDING');

    expect(fixtures.expiredAssignments.credential.valid).toBe(false);
    expect(fixtures.expiredAssignments.credential.reasonCode).toBe(
      'NO_ACTIVE_ASSIGNMENT',
    );

    expect(fixtures.blockedAccount.accountStatus).toBe('BLOCKED');
    expect(fixtures.blockedAccount.credential.reasonCode).toBe(
      'ACCOUNT_BLOCKED',
    );
  });

  it('garante ausência de senha, passwordHash ou tokenHash nos DTOs e projeção pública mínima', () => {
    const serialized = JSON.stringify(fixtures);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('tokenHash');

    expect(fixtures.publicVerificationValid).not.toHaveProperty('rg');
    expect(fixtures.publicVerificationValid).not.toHaveProperty('email');
    expect(fixtures.publicVerificationBlocked.valid).toBe(false);
    expect(fixtures.publicVerificationBlocked).not.toHaveProperty(
      'displayName',
    );
  });

  it('valida conflito 409, lote parcial e recibo offline perdido', () => {
    expect(fixtures.versionConflictError.statusCode).toBe(409);
    expect(fixtures.versionConflictError.code).toBe('VERSION_CONFLICT');
    expect(fixtures.partialImportBatch.state).toBe('PARTIAL');
    expect(fixtures.lostOfflineReceipt.result).toBeDefined();
  });

  it('materializa documento OpenAPI JSON válido com todas as rotas principais', () => {
    expect(openapi.openapi).toBe('3.1.0');
    const requiredPaths = [
      '/autenticacao/funcionarios/login',
      '/autenticacao/funcionarios/solicitar-acesso',
      '/autenticacao/funcionarios/ativar',
      '/autenticacao/funcionarios/forgot-password',
      '/autenticacao/funcionarios/reset',
      '/autenticacao/funcionarios/alterar-senha',
      '/funcionarios/me',
      '/funcionarios/me/carteirinha',
      '/funcionarios/me/foto',
      '/funcionarios',
      '/funcionarios/{id}',
      '/funcionarios/{id}/funcoes',
      '/funcionarios/fotos/pendentes',
      '/funcionarios/modelo-importacao',
      '/funcionarios/importacoes/analisar',
      '/funcionarios/verificar/{qrcode}',
      '/public/institution',
      '/attendances/employee-offline/session',
      '/event-management/employees/search',
    ];
    for (const route of requiredPaths) {
      expect(openapi.paths).toHaveProperty(route);
    }
  });
});
