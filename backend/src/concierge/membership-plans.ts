/**
 * P0 Technical Build Spec v1.0 Section 17 "Membership Engine" — plan
 * pricing/benefits (price, SC grant, discount%, eligible requests/month)
 * used to live here as a code constant. That's now DB-backed via
 * MembershipPlanConfig / PlanConfigService (P0 UX Spec's "Admin Screen —
 * Pricing Configuration"), so Finance/Admin can adjust it without a
 * deploy — see plan-config.service.ts. This file now only holds the FX
 * helper, which is unrelated to per-plan pricing.
 */

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
