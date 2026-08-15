// ═══════════════════════════════════════════════════════════════════════════════
// ASOJU FieldForce — GPS Geofence Validation (P0.4)
// Server-side geofence validation with anti-spoofing measures
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Validation Constants ─────────────────────────────────────────────────────

export const GEOFENCE_RADIUS_METERS = 100;       // Default geofence radius
export const MAX_REPORTED_ACCURACY = 50;         // Max acceptable GPS accuracy (meters)
export const MAX_LOCATION_AGE_MS = 120_000;      // Max location age (2 minutes)
export const MIN_LATITUDE = -90;
export const MAX_LATITUDE = 90;
export const MIN_LONGITUDE = -180;
export const MAX_LONGITUDE = 180;

// ─── Rejection Reason Types ──────────────────────────────────────────────────

export type GpsRejectionReason =
  | 'INVALID_COORDINATES'   // lat/lng out of valid range or NaN
  | 'ACCURACY_TOO_LOW'      // reported accuracy > 50m
  | 'LOCATION_STALE'        // capture timestamp > 120s ago
  | 'OUTSIDE_GEOFENCE'      // distance > 100m
  | 'MISSING_TIMESTAMP';    // no capturedAt provided

// ─── Validation Result ──────────────────────────────────────────────────────

export type GpsValidationResult =
  | { valid: true; distance: number; result: 'PASS'; geofenceRadius: number }
  | { valid: false; reason: GpsRejectionReason; result: 'FAIL'; distance?: number };

// ─── Coordinate Validation ────────────────────────────────────────────────────

export function validateCoordinates(
  lat: number | undefined | null,
  lng: number | undefined | null
): { valid: boolean; reason?: string } {
  if (lat === undefined || lat === null || lng === undefined || lng === null) {
    return { valid: false, reason: 'Coordinates are required' };
  }

  if (isNaN(lat) || isNaN(lng)) {
    return { valid: false, reason: 'Coordinates must be valid numbers' };
  }

  if (lat < MIN_LATITUDE || lat > MAX_LATITUDE) {
    return { valid: false, reason: `Latitude must be between ${MIN_LATITUDE} and ${MAX_LATITUDE}` };
  }

  if (lng < MIN_LONGITUDE || lng > MAX_LONGITUDE) {
    return { valid: false, reason: `Longitude must be between ${MIN_LONGITUDE} and ${MAX_LONGITUDE}` };
  }

  return { valid: true };
}

// ─── Accuracy Validation ───────────────────────────────────────────────────

export function validateAccuracy(accuracy: number | undefined | null): { valid: boolean; reason?: string } {
  if (accuracy === undefined || accuracy === null) {
    return { valid: false, reason: 'GPS accuracy is required' };
  }

  if (accuracy < 0) {
    return { valid: false, reason: 'GPS accuracy cannot be negative' };
  }

  if (accuracy > MAX_REPORTED_ACCURACY) {
    return { valid: false, reason: `GPS accuracy (${accuracy}m) exceeds maximum allowed (${MAX_REPORTED_ACCURACY}m)` };
  }

  return { valid: true };
}

// ─── Location Age Validation ────────────────────────────────────────────────

export function validateLocationAge(capturedAt: string | Date | undefined | null): { valid: boolean; reason?: string } {
  if (!capturedAt) {
    return { valid: false, reason: 'Location capture timestamp is required' };
  }

  const captureTime = capturedAt instanceof Date ? capturedAt.getTime() : new Date(capturedAt).getTime();
  const ageMs = Date.now() - captureTime;

  if (isNaN(captureTime)) {
    return { valid: false, reason: 'Invalid capture timestamp' };
  }

  if (ageMs < 0) {
    return { valid: false, reason: 'Capture timestamp is in the future' };
  }

  if (ageMs > MAX_LOCATION_AGE_MS) {
    const ageSeconds = Math.round(ageMs / 1000);
    return {
      valid: false,
      reason: `Location data is too old (${ageSeconds}s). Maximum age is ${MAX_LOCATION_AGE_MS / 1000}s.`,
    };
  }

  return { valid: true };
}

// ─── Haversine Distance Calculation ──────────────────────────────────────────
// Returns distance in meters between two GPS coordinates

export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// ─── Polygon Containment Check (Ray Casting) ─────────────────────────────────
// For future polygon geofences. Point-in-polygon using ray casting algorithm.

export function isPointInPolygon(
  pointLat: number,
  pointLng: number,
  polygon: Array<{ lat: number; lng: number }>
): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].lat;
    const yi = polygon[i].lng;
    const xj = polygon[j].lat;
    const yj = polygon[j].lng;

    const intersect =
      yi > pointLng !== yj > pointLng &&
      pointLat < ((xj - xi) * (pointLng - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

// ─── Full Geofence Validation ───────────────────────────────────────────────
// Orchestrates all validation steps and returns a complete result

export interface GeofenceCheckInput {
  agentLat: number;
  agentLng: number;
  accuracy: number;
  capturedAt: string | Date;
  targetLat: number;
  targetLng: number;
  geofenceRadius?: number; // Override default radius
}

export function validateGeofence(input: GeofenceCheckInput): GpsValidationResult {
  const radius = input.geofenceRadius ?? GEOFENCE_RADIUS_METERS;

  // Step 1: Validate coordinates
  const coordCheck = validateCoordinates(input.agentLat, input.agentLng);
  if (!coordCheck.valid) {
    return { valid: false, reason: 'INVALID_COORDINATES', result: 'FAIL' };
  }

  // Step 2: Validate accuracy
  const accuracyCheck = validateAccuracy(input.accuracy);
  if (!accuracyCheck.valid) {
    return { valid: false, reason: 'ACCURACY_TOO_LOW', result: 'FAIL' };
  }

  // Step 3: Validate location age
  const ageCheck = validateLocationAge(input.capturedAt);
  if (!ageCheck.valid) {
    return { valid: false, reason: 'LOCATION_STALE', result: 'FAIL' };
  }

  // Step 4: Calculate distance
  const distance = haversineDistance(
    input.agentLat,
    input.agentLng,
    input.targetLat,
    input.targetLng
  );

  // Step 5: Check geofence
  if (distance > radius) {
    return {
      valid: false,
      reason: 'OUTSIDE_GEOFENCE',
      result: 'FAIL',
      distance,
    };
  }

  // All checks passed
  return {
    valid: true,
    distance,
    result: 'PASS',
    geofenceRadius: radius,
  };
}

// ─── Geofence Rule Parser ────────────────────────────────────────────────────
// Parse geofence rules stored in database (e.g., "RADIUS_100M", "POLYGON:...")

export interface GeofenceRule {
  type: 'RADIUS' | 'POLYGON';
  radiusMeters?: number;
  polygon?: Array<{ lat: number; lng: number }>;
}

export function parseGeofenceRule(rule: string | null | undefined): GeofenceRule {
  if (!rule) {
    return { type: 'RADIUS', radiusMeters: GEOFENCE_RADIUS_METERS };
  }

  // RADIUS_100M format
  const radiusMatch = rule.match(/^RADIUS_(\d+)M$/i);
  if (radiusMatch) {
    return { type: 'RADIUS', radiusMeters: parseInt(radiusMatch[1], 10) };
  }

  // POLYGON:lat1,lng1;lat2,lng2;lat3,lng3 format
  if (rule.startsWith('POLYGON:')) {
    const coordsStr = rule.slice(8);
    const polygon = coordsStr.split(';').map((pair) => {
      const [lat, lng] = pair.split(',').map(Number);
      return { lat, lng };
    }).filter((p) => !isNaN(p.lat) && !isNaN(p.lng));

    if (polygon.length >= 3) {
      return { type: 'POLYGON', polygon };
    }
  }

  // Default fallback
  return { type: 'RADIUS', radiusMeters: GEOFENCE_RADIUS_METERS };
}

// ─── Build Geofence Rule String ─────────────────────────────────────────────

export function buildRadiusRule(meters: number): string {
  return `RADIUS_${meters}M`;
}
