import { ServiceType } from '@prisma/client';

/**
 * docs/FRONTEND_HANDOFF_V1_GAP_MAP.md §1 "Locked six-service architecture
 * vs. the real backend" — Option B, the additive layer: the real
 * `ServiceType` enum (10 values, everything else in this app keyed off
 * it — regional pricing, predictive costing, QC outcome taxonomy, quote
 * line categories, `service-verticals.e2e-spec.ts`) stays exactly as-is.
 * `ServiceFamily` is a derived/display concept for public-facing
 * surfaces only (homepage, service pages) — the six locked families
 * ("Farewell is explicitly excluded from the public service
 * architecture"). Mirrors `frontend/src/lib/services.ts`'s
 * `SERVICE_FAMILIES.serviceTypes` exactly, field by field — see
 * `service-family.spec.ts` for the two-way check that keeps this file
 * and every real `ServiceType` value honestly covered.
 */
export type ServiceFamily = 'arrivals' | 'inspect' | 'build' | 'care' | 'verify' | 'assist';

export const SERVICE_TYPE_TO_FAMILY: Record<ServiceType, ServiceFamily> = {
  [ServiceType.ARRIVAL_SUPPORT]: 'arrivals',
  [ServiceType.PROPERTY_INSPECTION]: 'inspect',
  [ServiceType.ASSET_INSPECTION]: 'inspect',
  [ServiceType.CONSTRUCTION_SUPERVISION]: 'build',
  [ServiceType.FAMILY_SUPPORT]: 'care',
  [ServiceType.BEREAVEMENT_SUPPORT]: 'care',
  [ServiceType.BUSINESS_VERIFICATION]: 'verify',
  [ServiceType.PROCUREMENT]: 'assist',
  [ServiceType.INVESTMENT_SUPPORT]: 'assist',
  [ServiceType.AGRICULTURE_SUPPORT]: 'assist',
  // Added after the gap-map's original 10-value table (Platform Expansion
  // PRD §6.2/§6.3) — not yet reflected in frontend/src/lib/services.ts's
  // SERVICE_FAMILIES either. Categorized by the same reasoning as their
  // schema comments: title/CAC document work sits with the other
  // verification-shaped service (BUSINESS_VERIFICATION); a hospital-visit/
  // medical-checkup coordination is family/beneficiary-facing support,
  // same shape as FAMILY_SUPPORT/BEREAVEMENT_SUPPORT.
  [ServiceType.LEGAL_DOCUMENT_SERVICES]: 'verify',
  [ServiceType.HEALTHCARE_COORDINATION]: 'care',
};

const FAMILY_NAMES: Record<ServiceFamily, string> = {
  arrivals: 'ASOJU Arrivals',
  inspect: 'ASOJU Inspect',
  build: 'ASOJU Build',
  care: 'ASOJU Care',
  verify: 'ASOJU Verify',
  assist: 'ASOJU Assist',
};

/** Display order matches the homepage's own locked six-service-card
 * order (`frontend/src/lib/services.ts`), not alphabetical. */
export const SERVICE_FAMILY_ORDER: ServiceFamily[] = ['arrivals', 'inspect', 'build', 'care', 'verify', 'assist'];

export interface ServiceFamilyMetadata {
  slug: ServiceFamily;
  name: string;
  serviceTypes: ServiceType[];
}

export function familyForServiceType(serviceType: ServiceType): ServiceFamily {
  return SERVICE_TYPE_TO_FAMILY[serviceType];
}

/** `GET /service-families` — a real, backend-authoritative source for the
 * grouping the frontend's marketing surfaces already display, computed
 * fresh from `SERVICE_TYPE_TO_FAMILY` rather than hand-maintained twice. */
export function listServiceFamilies(): ServiceFamilyMetadata[] {
  const byFamily = new Map<ServiceFamily, ServiceType[]>();
  for (const [serviceType, family] of Object.entries(SERVICE_TYPE_TO_FAMILY) as [ServiceType, ServiceFamily][]) {
    const list = byFamily.get(family) ?? [];
    list.push(serviceType);
    byFamily.set(family, list);
  }
  return SERVICE_FAMILY_ORDER.map((slug) => ({
    slug,
    name: FAMILY_NAMES[slug],
    serviceTypes: byFamily.get(slug) ?? [],
  }));
}
