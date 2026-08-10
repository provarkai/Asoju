import { MembershipPlan } from '@prisma/client';

/**
 * P0 Technical Build Spec v1.0 Section 17 "Membership Engine" — pricing is
 * a business rule, not a database row (yet): kept as a code constant here,
 * matching this codebase's existing convention for other business-rule
 * tables (e.g. checklist-templates.ts). Admin-configurable pricing
 * (P0 UX Spec's "Admin Screen — Pricing Configuration") is a separate,
 * larger increment layered on top of this later, not a blocker to having
 * the commercial rules actually enforced now.
 */
export interface MembershipPlanConfig {
  priceUsd: number;
  scGrantUsd: number;
  discountPercent: number;
  eligibleRequestsPerMonth: number;
}

export const MEMBERSHIP_PLANS: Record<MembershipPlan, MembershipPlanConfig> = {
  [MembershipPlan.PRIORITY]: { priceUsd: 99, scGrantUsd: 50, discountPercent: 10, eligibleRequestsPerMonth: 2 },
  [MembershipPlan.PREMIUM]: { priceUsd: 299, scGrantUsd: 150, discountPercent: 15, eligibleRequestsPerMonth: 5 },
};

const DEFAULT_USD_TO_NGN_RATE = 1600;

/**
 * P0 Technical Build Spec Section 19 "FX Pricing → Naira Execution" —
 * "a configured source/manual approved rate", not a live FX-provider
 * integration (that remains a separate, not-yet-built increment covering
 * the general Quote engine; membership pricing needed *a* rate to be
 * chargeable at all, so it gets the minimal, honest version: one
 * operator-set number, not a treasury feed).
 */
export function usdToNgnRate(): number {
  const configured = process.env.USD_TO_NGN_RATE;
  const parsed = configured ? Number(configured) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_USD_TO_NGN_RATE;
}
