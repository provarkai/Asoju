import { evaluateCheckIn, haversineDistanceMeters, validateAccuracy, validateCoordinates, validateLocationAge } from './geofence';

describe('geofence primitives', () => {
  it('validateCoordinates rejects out-of-range and non-numeric input', () => {
    expect(validateCoordinates(6.6, 3.35)).toBe(true);
    expect(validateCoordinates(200, 3.35)).toBe(false);
    expect(validateCoordinates(6.6, -200)).toBe(false);
    expect(validateCoordinates('6.6', 3.35)).toBe(false);
    expect(validateCoordinates(NaN, 3.35)).toBe(false);
  });

  it('validateAccuracy passes when unset, fails when too imprecise', () => {
    expect(validateAccuracy(undefined)).toBe(true);
    expect(validateAccuracy(10)).toBe(true);
    expect(validateAccuracy(50)).toBe(true);
    expect(validateAccuracy(51)).toBe(false);
    expect(validateAccuracy(0)).toBe(false);
  });

  it('validateLocationAge passes when unset, fails when stale', () => {
    expect(validateLocationAge(undefined)).toBe(true);
    expect(validateLocationAge(new Date().toISOString())).toBe(true);
    expect(validateLocationAge(new Date(Date.now() - 10 * 60_000).toISOString())).toBe(false);
    expect(validateLocationAge('not-a-date')).toBe(false);
  });

  it('haversineDistanceMeters returns ~0 for identical points and a sane real-world distance for known cities', () => {
    const point = { lat: 6.6018, lng: 3.3515 };
    expect(haversineDistanceMeters(point, point)).toBeLessThan(1);

    // Ikeja to Victoria Island, Lagos — known to be roughly 15-20km apart.
    const ikeja = { lat: 6.6018, lng: 3.3515 };
    const victoriaIsland = { lat: 6.4281, lng: 3.4219 };
    const distance = haversineDistanceMeters(ikeja, victoriaIsland);
    expect(distance).toBeGreaterThan(15_000);
    expect(distance).toBeLessThan(25_000);
  });

  describe('evaluateCheckIn', () => {
    it('is UNVERIFIED, never REJECTED, when no coordinates are supplied at all', () => {
      const result = evaluateCheckIn({});
      expect(result).toEqual({ outcome: 'UNVERIFIED', reason: 'NO_COORDINATES_SUPPLIED' });
    });

    it('is UNVERIFIED when real coordinates are supplied but no target is on file', () => {
      const result = evaluateCheckIn({ lat: 6.6, lng: 3.35, accuracy: 10 });
      expect(result).toEqual({ outcome: 'UNVERIFIED', reason: 'NO_TARGET_ON_FILE' });
    });

    it('REJECTS structurally invalid coordinates regardless of target', () => {
      const result = evaluateCheckIn({ lat: 200, lng: 3.35 });
      expect(result).toEqual({ outcome: 'REJECTED', reason: 'INVALID_COORDINATES' });
    });

    it('REJECTS accuracy worse than the threshold even with no target', () => {
      const result = evaluateCheckIn({ lat: 6.6, lng: 3.35, accuracy: 500 });
      expect(result).toEqual({ outcome: 'REJECTED', reason: 'ACCURACY_TOO_LOW' });
    });

    it('REJECTS a stale fix even with no target', () => {
      const result = evaluateCheckIn({ lat: 6.6, lng: 3.35, capturedAt: new Date(Date.now() - 10 * 60_000).toISOString() });
      expect(result).toEqual({ outcome: 'REJECTED', reason: 'LOCATION_STALE' });
    });

    it('PASSes within the geofence radius of a real target, and reports distance', () => {
      const target = { lat: 6.6018, lng: 3.3515 };
      const nearby = { lat: 6.60215, lng: 3.35195 }; // ~45m away
      const result = evaluateCheckIn({ ...nearby, accuracy: 12, targetLat: target.lat, targetLng: target.lng });

      expect(result.outcome).toBe('PASS');
      expect(result.distanceMeters).toBeLessThan(150);
    });

    it('REJECTS as OUTSIDE_GEOFENCE when well outside the radius of a real target', () => {
      const target = { lat: 6.6018, lng: 3.3515 };
      const far = { lat: 6.4281, lng: 3.4219 };
      const result = evaluateCheckIn({ ...far, accuracy: 12, targetLat: target.lat, targetLng: target.lng });

      expect(result.outcome).toBe('REJECTED');
      expect(result.reason).toBe('OUTSIDE_GEOFENCE');
      expect(result.distanceMeters).toBeGreaterThan(150);
    });

    it('respects a custom radiusMeters override', () => {
      const target = { lat: 6.6018, lng: 3.3515 };
      const nearby = { lat: 6.60215, lng: 3.35195 }; // ~45m away
      const result = evaluateCheckIn({ ...nearby, accuracy: 12, targetLat: target.lat, targetLng: target.lng, radiusMeters: 10 });

      expect(result.outcome).toBe('REJECTED');
      expect(result.reason).toBe('OUTSIDE_GEOFENCE');
    });
  });
});
