import { CasePriority, PricingZone } from '@prisma/client';

/** Platform Expansion PRD §2.2 — "Base Regional Pricing": Lagos $50,
 * South-West (excl. Lagos) $80, Other Locations TBD (a Case Manager sets
 * the actual fee by hand — this deliberately returns null rather than a
 * made-up number, so staff can't miss that it's unpriced). Figures are
 * USD, same as the membership plan pricing (MembershipPlanConfig.priceUsd)
 * — converted at quote time via the same usdToNgnRate() used everywhere
 * else currency crosses from USD to the NGN a customer actually pays. */
const BASE_RATE_USD: Record<Exclude<PricingZone, 'OTHER'>, number> = {
  [PricingZone.LAGOS]: 50,
  [PricingZone.SOUTH_WEST]: 80,
};

/** §2.2 "Modifiers" — "Urgent/24hr SLA = 1.5x Base Rate." CasePriority.URGENT
 * is this platform's existing 24h-SLA tier (see cases.service.ts's
 * DEFAULT_SLA_HOURS), so it's the natural trigger rather than inventing a
 * second urgency concept. */
export const URGENCY_MULTIPLIER = 1.5;

export interface RegionalPricingSuggestion {
  zone: PricingZone;
  baseRateUsd: number | null;
  urgencyMultiplierApplied: boolean;
  suggestedServiceFeeUsd: number | null;
  /** §2.3 "SC Exclusion Rule" — false for Other Locations regardless of
   * subscription/tier; the actual enforcement lives in
   * MembershipService.previewBenefit (this flag is informational, for
   * staff building the quote to see up front, not itself a gate). */
  scEligible: boolean;
}

export function suggestRegionalServiceFee(zone: PricingZone, priority: CasePriority): RegionalPricingSuggestion {
  const baseRateUsd = zone === PricingZone.OTHER ? null : BASE_RATE_USD[zone];
  const urgencyMultiplierApplied = priority === CasePriority.URGENT;
  const suggestedServiceFeeUsd =
    baseRateUsd === null ? null : urgencyMultiplierApplied ? Math.round(baseRateUsd * URGENCY_MULTIPLIER * 100) / 100 : baseRateUsd;

  return {
    zone,
    baseRateUsd,
    urgencyMultiplierApplied,
    suggestedServiceFeeUsd,
    scEligible: zone !== PricingZone.OTHER,
  };
}
