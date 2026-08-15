// Locked six-service public architecture — docs/frontend-handoff-v1.0/
// 01_Product_Architecture/ASOJU_Master_Services_Frontend_Engineering_
// Specification_v1.0.docx §2/§25: "Farewell is excluded from the public
// service architecture." One shared config so the header menu, mobile
// nav and (Sprint 6) service pages don't each redefine this list.
//
// serviceTypes cross-references the real backend ServiceType enum
// (backend/prisma/schema.prisma) per docs/FRONTEND_HANDOFF_V1_GAP_MAP.md
// §1 — the mapping is display-only until the Sprint 1 backend ticket
// proposed there (restructure ServiceType -> ServiceFamily) lands; it is
// not yet wired into case creation.

export interface ServiceFamily {
  slug: string;
  name: string;
  tagline: string;
  serviceTypes: string[];
}

export const SERVICE_FAMILIES: ServiceFamily[] = [
  {
    slug: 'arrivals',
    name: 'ASOJU Arrivals',
    tagline: 'Airport pickup, accommodation and pre-arrival coordination.',
    serviceTypes: ['ARRIVAL_SUPPORT'],
  },
  {
    slug: 'inspect',
    name: 'ASOJU Inspect',
    tagline: 'Property and asset inspection, with dated evidence.',
    serviceTypes: ['PROPERTY_INSPECTION', 'ASSET_INSPECTION'],
  },
  {
    slug: 'build',
    name: 'ASOJU Build',
    tagline: 'Construction and project supervision while you’re away.',
    serviceTypes: ['CONSTRUCTION_SUPERVISION'],
  },
  {
    slug: 'care',
    name: 'ASOJU Care',
    tagline: 'Family and personal matters handled by a trusted local presence.',
    serviceTypes: ['FAMILY_SUPPORT', 'BEREAVEMENT_SUPPORT'],
  },
  {
    slug: 'verify',
    name: 'ASOJU Verify',
    tagline: 'Business, vendor and document verification.',
    serviceTypes: ['BUSINESS_VERIFICATION'],
  },
  {
    slug: 'assist',
    name: 'ASOJU Assist',
    tagline: 'Procurement, collection and other supported local tasks.',
    serviceTypes: ['PROCUREMENT', 'INVESTMENT_SUPPORT', 'AGRICULTURE_SUPPORT'],
  },
];
