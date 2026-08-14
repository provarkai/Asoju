// ═══════════════════════════════════════════════════════════════════════════════
// Field Agent GPS Check-In — Geofence Validation
// ═══════════════════════════════════════════════════════════════════════════════
// Ported from fieldforce/src/lib/gps-geofence.ts's validation primitives —
// confirmed there was nothing equivalent here before now: Assignment.checkIn
// took a free-form `location` blob and stored it unvalidated, no matter what
// it contained.
//
// One deliberate difference from FieldForce's version: FieldForce always has
// a mission-level target (with a hardcoded demo-coordinate fallback when one
// isn't set). ASOJU's Property/Asset model has no coordinates on the vast
// majority of records today — nothing geocodes an address into a lat/lng —
// so fabricating a fallback target would produce meaningless PASS/FAIL
// verdicts. Instead: a real target enables full validation and can reject a
// check-in outright; no target means the check-in is never blocked on GPS
// grounds, and is recorded as UNVERIFIED rather than silently marked PASS.

export const MAX_ACCURACY_METERS = 50;
export const MAX_LOCATION_AGE_MS = 120_000; // 2 minutes
export const DEFAULT_GEOFENCE_RADIUS_METERS = 150; // wider than FieldForce's 100m default — allows for looser Nigerian property-boundary/addressing precision
const EARTH_RADIUS_METERS = 6_371_000;

export type GeofenceOutcome = 'PASS' | 'UNVERIFIED' | 'REJECTED';

export interface GeofenceCheckInput {
  lat?: number;
  lng?: number;
  accuracy?: number;
  capturedAt?: string | Date;
  targetLat?: number | null;
  targetLng?: number | null;
  radiusMeters?: number;
}

export interface GeofenceCheckResult {
  outcome: GeofenceOutcome;
  reason?: string;
  distanceMeters?: number;
}

export function validateCoordinates(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function validateAccuracy(accuracy: number | undefined): boolean {
  if (accuracy === undefined) return true; // client didn't report accuracy — not itself a rejection reason
  return Number.isFinite(accuracy) && accuracy > 0 && accuracy <= MAX_ACCURACY_METERS;
}

export function validateLocationAge(capturedAt: string | Date | undefined): boolean {
  if (!capturedAt) return true; // no timestamp supplied — treated as "now" by the caller, not a rejection reason
  const ts = new Date(capturedAt).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= MAX_LOCATION_AGE_MS;
}

export function haversineDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Evaluates a field-agent check-in's GPS data. No lat/lng at all (a plain
 * address string, or nothing) is always UNVERIFIED, never rejected — this
 * preserves the check-in flow's current behaviour for the common case.
 * Real coordinates that are structurally invalid, too imprecise, or stale
 * are REJECTED regardless of whether a target exists (bad data is bad
 * data). A real target coordinate pair turns this into an actual geofence:
 * outside the radius is REJECTED; inside is PASS.
 */
export function evaluateCheckIn(input: GeofenceCheckInput): GeofenceCheckResult {
  const { lat, lng, accuracy, capturedAt, targetLat, targetLng } = input;
  const radiusMeters = input.radiusMeters ?? DEFAULT_GEOFENCE_RADIUS_METERS;

  if (lat === undefined || lng === undefined) {
    return { outcome: 'UNVERIFIED', reason: 'NO_COORDINATES_SUPPLIED' };
  }

  if (!validateCoordinates(lat, lng)) {
    return { outcome: 'REJECTED', reason: 'INVALID_COORDINATES' };
  }
  if (!validateAccuracy(accuracy)) {
    return { outcome: 'REJECTED', reason: 'ACCURACY_TOO_LOW' };
  }
  if (!validateLocationAge(capturedAt)) {
    return { outcome: 'REJECTED', reason: 'LOCATION_STALE' };
  }

  if (targetLat === undefined || targetLat === null || targetLng === undefined || targetLng === null) {
    return { outcome: 'UNVERIFIED', reason: 'NO_TARGET_ON_FILE' };
  }

  const distanceMeters = haversineDistanceMeters({ lat, lng }, { lat: targetLat, lng: targetLng });
  if (distanceMeters > radiusMeters) {
    return { outcome: 'REJECTED', reason: 'OUTSIDE_GEOFENCE', distanceMeters: Math.round(distanceMeters) };
  }

  return { outcome: 'PASS', distanceMeters: Math.round(distanceMeters) };
}

export const GEOFENCE_REJECTION_MESSAGES: Record<string, string> = {
  INVALID_COORDINATES: 'The reported GPS coordinates are not valid.',
  ACCURACY_TOO_LOW: `GPS accuracy must be within ${MAX_ACCURACY_METERS}m to check in.`,
  LOCATION_STALE: 'The reported location is too old — retry check-in with a fresh GPS fix.',
  OUTSIDE_GEOFENCE: 'Check-in location is outside the expected radius for this case.',
};
