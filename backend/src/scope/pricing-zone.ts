import { PricingZone } from '@prisma/client';

/** Platform Expansion PRD §2.2 "Variable Quoting Engine (Region-Based
 * Pricing)" — the deterministic regional matrix protecting contribution
 * margin depends on every case landing in exactly one zone. Lagos and the
 * rest of the South-West get a known, historically-costed base rate;
 * everywhere else is "Other Locations" — deliberately unpriced here
 * (§2.2: "TBD by Case Manager at scoping based on logistics/agent
 * availability") and, per §2.3's SC Exclusion Rule, never SC-eligible.
 *
 * This is a *default*, not a decision — ScopeService.createOrRevise only
 * falls back to it when staff don't explicitly set CreateScopeDto.zone,
 * matching the PRD's "Case Manager at scoping" framing: the classifier
 * gets the obvious cases right (a "Lagos" case is a Lagos case) so staff
 * only have to think about the ones it can't know (a bare LGA name, a
 * landmark, a diaspora client's phonetic spelling), never about typing
 * "Lagos Zone" by hand every time. */

/** South-West Nigeria states other than Lagos itself — matches §2.2's
 * "South-West Zone (Excl. Lagos)" tier. */
const SOUTH_WEST_STATES = ['oyo', 'ogun', 'osun', 'ondo', 'ekiti'];

export function classifyZone(location: string): PricingZone {
  const normalized = location.toLowerCase();
  if (normalized.includes('lagos')) return PricingZone.LAGOS;
  if (SOUTH_WEST_STATES.some((state) => normalized.includes(state))) return PricingZone.SOUTH_WEST;
  return PricingZone.OTHER;
}
