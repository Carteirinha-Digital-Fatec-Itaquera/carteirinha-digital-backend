import { assertGeoPolicy } from './presence-policy';

/** Ponto informado pela organização; limites iniciais devem ser calibrados no auditório. */
export function defaultEventVenue(env: NodeJS.ProcessEnv = process.env) {
  const policy = assertGeoPolicy({
    latitude: Number(env.EVENT_VENUE_LATITUDE ?? '-23.54503950757055'),
    longitude: Number(env.EVENT_VENUE_LONGITUDE ?? '-46.46790057119243'),
    radius: Number(env.EVENT_VENUE_RADIUS_METERS ?? '150'),
    maxAccuracy: Number(env.EVENT_VENUE_MAX_ACCURACY_METERS ?? '50'),
  })!;
  return {
    name: 'Fatec Itaquera',
    address:
      'Av. Miguel Ignácio Curi, 360 - Itaquera, São Paulo - SP, 08295-005',
    policy,
    calibrationRequired: true,
  };
}
