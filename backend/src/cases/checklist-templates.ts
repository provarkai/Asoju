import { ServiceType } from '@prisma/client';

/**
 * Section 6.1 — Standard Field Checklist Pattern. The PRD gives Property
 * Inspection's checklist verbatim and says "every service gets its own
 * version of this pattern" — these are that pattern applied to the other
 * two MVP services, generalized from their Section 6 scope descriptions.
 * Seeded onto a ServiceCase's CaseTask rows at creation (convertToCase).
 */
export const CHECKLIST_TEMPLATES: Record<ServiceType, string[]> = {
  [ServiceType.PROPERTY_INSPECTION]: [
    'Confirm location',
    'Photograph entrance / access road',
    'Photograph surrounding development',
    'Photograph the property',
    'Capture site video',
    'Record observations',
    'Collect available documents',
    'Identify exceptions',
    'Complete inspection submission',
  ],
  [ServiceType.CONSTRUCTION_SUPERVISION]: [
    'Confirm site location',
    'Photograph current progress (all angles)',
    'Record contractor observations',
    'Verify materials on site',
    'Verify work matches agreed scope',
    'Capture progress video',
    'Record observations',
    'Identify exceptions',
    'Complete supervision submission',
  ],
  [ServiceType.ASSET_INSPECTION]: [
    'Confirm asset location',
    'Photograph the asset (all angles)',
    'Capture asset video',
    'Record condition observations',
    'Collect available documents',
    'Identify exceptions',
    'Complete inspection submission',
  ],
};
