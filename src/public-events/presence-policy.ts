import { BadRequestException } from '@nestjs/common';

export interface GeoPolicy {
  latitude: number;
  longitude: number;
  radius: number;
  maxAccuracy: number;
}
export interface PositionEvidence {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
  challengeId: string;
}
export function assertGeoPolicy(value: unknown): GeoPolicy | null {
  if (value === null || value === undefined) return null;
  const p = value as GeoPolicy;
  if (
    ![p.latitude, p.longitude, p.radius, p.maxAccuracy].every(
      Number.isFinite,
    ) ||
    Math.abs(p.latitude) > 90 ||
    Math.abs(p.longitude) > 180 ||
    p.radius < 10 ||
    p.radius > 5000 ||
    p.maxAccuracy < 1 ||
    p.maxAccuracy > p.radius
  )
    throw new BadRequestException('Localização/raio/precisão inválidos');
  return {
    latitude: p.latitude,
    longitude: p.longitude,
    radius: p.radius,
    maxAccuracy: p.maxAccuracy,
  };
}
export function evaluatePosition(
  policy: GeoPolicy,
  position: PositionEvidence,
  now = Date.now(),
) {
  if (
    !position ||
    ![
      position.latitude,
      position.longitude,
      position.accuracy,
      position.timestamp,
    ].every(Number.isFinite) ||
    Math.abs(position.latitude) > 90 ||
    Math.abs(position.longitude) > 180 ||
    position.accuracy < 0 ||
    Math.abs(now - position.timestamp) > 60000
  )
    throw new BadRequestException({
      code: 'LOCATION_INVALID',
      message: 'Obtenha uma localização recente.',
    });
  const rad = (v: number) => (v * Math.PI) / 180;
  const a =
    Math.sin(rad(position.latitude - policy.latitude) / 2) ** 2 +
    Math.cos(rad(policy.latitude)) *
      Math.cos(rad(position.latitude)) *
      Math.sin(rad(position.longitude - policy.longitude) / 2) ** 2;
  const distance =
    6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  if (
    position.accuracy > policy.maxAccuracy ||
    distance + position.accuracy > policy.radius
  )
    throw new BadRequestException({
      code: 'LOCATION_INCONCLUSIVE',
      message:
        'Localização fora da área ou imprecisa. Tente novamente ou procure a Secretaria presencialmente.',
    });
  return {
    decision: 'INSIDE',
    accuracyBand: Math.ceil(position.accuracy / 10) * 10,
  };
}
