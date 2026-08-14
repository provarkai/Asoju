import { PricingZone } from '@prisma/client';
import { classifyZone } from '../scope/pricing-zone';

/** Platform Expansion PRD §5.2 "Dynamic SLA by LGA/Region" — reuses §2.2's
 * regional-pricing zone classification (classifyZone) rather than modeling
 * a second geography system: Lagos is the operational hub (base SLA, no
 * adjustment), the rest of the South-West needs travel time built in, and
 * everywhere else ("Other Locations" — the same zone §2.2 leaves unpriced
 * pending Case Manager scoping) gets the most lenient target. Deterministic
 * and env-overridable, same shape as DEFAULT_SLA_HOURS/slaHoursForPriority
 * in cases.service.ts. */
const DEFAULT_REGIONAL_SLA_MULTIPLIER: Record<PricingZone, number> = {
  [PricingZone.LAGOS]: 1,
  [PricingZone.SOUTH_WEST]: 1.25,
  [PricingZone.OTHER]: 1.5,
};

function regionalSlaMultiplier(zone: PricingZone): number {
  const envVar = `SLA_MULTIPLIER_${zone}`;
  const configured = process.env[envVar];
  const parsed = configured ? Number(configured) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REGIONAL_SLA_MULTIPLIER[zone];
}

/** Combines CasePriority's base SLA window (slaHoursForPriority) with the
 * case's regional multiplier, rounded to the nearest whole hour — the
 * single source of truth both convertToCase and spawnCaseFromSchedule use
 * to set slaTargetAt. */
export function slaHoursForCase(baseSlaHours: number, location: string): number {
  const zone = classifyZone(location);
  return Math.round(baseSlaHours * regionalSlaMultiplier(zone));
}
