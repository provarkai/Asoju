import { getTrustTier, TRUST_TIERS } from './agent-trust-score.service';

describe('getTrustTier', () => {
  it('returns NEW for a fresh agent with no score', () => {
    expect(getTrustTier(0).tier).toBe('NEW');
  });

  it('returns the tier boundaries exactly (inclusive of min)', () => {
    expect(getTrustTier(19).tier).toBe('NEW');
    expect(getTrustTier(20).tier).toBe('BRONZE');
    expect(getTrustTier(39).tier).toBe('BRONZE');
    expect(getTrustTier(40).tier).toBe('SILVER');
    expect(getTrustTier(64).tier).toBe('SILVER');
    expect(getTrustTier(65).tier).toBe('GOLD');
    expect(getTrustTier(84).tier).toBe('GOLD');
    expect(getTrustTier(85).tier).toBe('PLATINUM');
    expect(getTrustTier(100).tier).toBe('PLATINUM');
  });

  it('every tier has a badge and a label', () => {
    for (const tier of TRUST_TIERS) {
      expect(tier.badge.length).toBeGreaterThan(0);
      expect(tier.label.length).toBeGreaterThan(0);
    }
  });
});
