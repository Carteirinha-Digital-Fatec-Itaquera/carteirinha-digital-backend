import type { PublicInstitutionInfoResponse } from '../contracts/v1-employees.types';

function optionalEnv(key: string): string | null {
  const val = process.env[key]?.trim();
  return val && val.length > 0 ? val : null;
}

export function getPublicInstitutionInfo(): PublicInstitutionInfoResponse {
  return {
    name: 'Faculdade de Tecnologia de Itaquera — Professor Miguel Reale',
    shortName: 'Fatec Itaquera',
    address:
      optionalEnv('INSTITUTION_ADDRESS') ??
      'Av. Miguel Ignácio Curi, 360 - Itaquera',
    city: optionalEnv('INSTITUTION_CITY') ?? 'São Paulo',
    state: optionalEnv('INSTITUTION_STATE') ?? 'SP',
    postalCode: optionalEnv('INSTITUTION_POSTAL_CODE') ?? '08295-005',
    phone: optionalEnv('INSTITUTION_PHONE'),
    email: optionalEnv('INSTITUTION_EMAIL'),
    website: optionalEnv('INSTITUTION_WEBSITE'),
  };
}
