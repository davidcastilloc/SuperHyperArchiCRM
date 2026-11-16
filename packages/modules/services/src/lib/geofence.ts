const EARTH_RADIUS_METERS = 6_371_000;
const MICROS_PER_DEGREE = 1_000_000;
export const DEFAULT_EVV_GEOFENCE_METERS = 250;

function toRadians(micros: number): number {
  return ((micros / MICROS_PER_DEGREE) * Math.PI) / 180;
}

/**
 * Computes integer ground distance in meters between two micro-degree coordinates.
 */
export function computeDistanceMeters(
  targetLatMicros: number,
  targetLngMicros: number,
  clockInLatMicros: number,
  clockInLngMicros: number,
): number {
  const lat1 = toRadians(targetLatMicros);
  const lat2 = toRadians(clockInLatMicros);
  const dLat = lat2 - lat1;
  const dLng = toRadians(clockInLngMicros - targetLngMicros);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const a =
    sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));

  return Math.round(EARTH_RADIUS_METERS * c);
}
