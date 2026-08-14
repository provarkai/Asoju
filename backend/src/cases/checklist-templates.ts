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

  // -- Section 12 P2 service categories -----------------------------------
  // Same standard-checklist pattern (Section 6.1), generalized from each
  // category's one-line scope in Section 1/12 rather than a full new
  // playbook — the platform-expansion services this repo does not (yet)
  // have a dedicated Section 6 write-up for.
  [ServiceType.FAMILY_SUPPORT]: [
    'Confirm beneficiary details and location',
    'Make contact / confirm welfare',
    'Photograph relevant documentation',
    'Record observations',
    'Identify exceptions',
    'Complete visit submission',
  ],
  [ServiceType.PROCUREMENT]: [
    'Confirm item specification and budget',
    'Source and compare at least two quotes',
    'Photograph the item(s) before purchase',
    'Complete purchase and collect receipt',
    'Photograph item(s) and receipt after purchase',
    'Arrange delivery / handoff',
    'Identify exceptions',
    'Complete procurement submission',
  ],
  [ServiceType.BUSINESS_VERIFICATION]: [
    'Confirm business name and registered address',
    'Photograph business premises',
    'Collect CAC / registration documents',
    'Record observations on business activity',
    'Identify exceptions',
    'Complete verification submission',
  ],
  [ServiceType.INVESTMENT_SUPPORT]: [
    'Confirm investment site / instrument details',
    'Photograph site or supporting documents',
    'Record observations',
    'Collect available documents',
    'Identify exceptions',
    'Complete review submission',
  ],
  [ServiceType.AGRICULTURE_SUPPORT]: [
    'Confirm farm / site location',
    'Photograph the farm (all sections)',
    'Capture site video',
    'Record crop/livestock condition observations',
    'Collect available documents',
    'Identify exceptions',
    'Complete inspection submission',
  ],

  // Tier 2 vertical (strategic-suggestions pass) — the most time-critical,
  // emotionally-sensitive service on the catalogue, so the checklist is a
  // vendor-coordination sub-checklist rather than an inspection one:
  // confirming the mortuary/venue/permit chain is actually moving, not
  // photographing a site. See SERVICE_TYPE_DEFAULT_PRIORITY (cases.service.ts)
  // for the accompanying default-urgent SLA override.
  [ServiceType.BEREAVEMENT_SUPPORT]: [
    'Confirm next of kin / family point of contact',
    'Confirm mortuary — location, hold status, and release requirements',
    'Confirm burial/venue booking and date',
    'Confirm permits and documentation required (death certificate, burial permit)',
    'Coordinate with officiant / clergy if requested',
    'Record observations',
    'Identify exceptions',
    'Complete coordination submission',
  ],

  // Phase 2 "ASOJU Arrival" (Master PRD v2.0 §6.4) — pre-arrival/welcome-
  // home coordination, from the same standard-checklist pattern generalized
  // from the service's scope bullets. ArrivalProfile (arrival.service.ts)
  // carries the structured flight/accommodation detail this checklist's
  // confirmations are actually checking against.
  [ServiceType.ARRIVAL_SUPPORT]: [
    'Confirm arrival date, flight, and accommodation address against the Arrival Profile',
    'Verify accommodation condition and readiness (photos)',
    'Confirm utilities / internet active at accommodation',
    'Confirm groceries and essentials stocked, if requested',
    'Confirm driver / vehicle arranged for airport pickup, if requested',
    'Complete airport pickup and meet-and-greet, if requested',
    'Record observations',
    'Identify exceptions',
    'Complete arrival coordination submission',
  ],

  // Platform Expansion PRD §6.2 "Legal / Document Services Vertical" —
  // "Title Verification" / "CAC Document Retrieval": the agent visits a
  // government registry instead of a physical property, so the standard
  // checklist pattern is generalized to registry visits and certified
  // document handoff rather than site photography.
  [ServiceType.LEGAL_DOCUMENT_SERVICES]: [
    'Confirm the document(s)/title requested and the issuing registry',
    'Confirm any reference numbers, file numbers, or prior correspondence needed for retrieval',
    'Visit the registry / government office',
    'Photograph the retrieved or verified document(s)',
    'Confirm document authenticity markers (seal, signature, watermark) where applicable',
    'Collect certified copies / receipts of any fees paid',
    'Record observations',
    'Identify exceptions',
    'Complete legal/document services submission',
  ],

  // Platform Expansion PRD §6.3 "Healthcare Coordination Vertical" —
  // "Hospital Visit / Medical Checkup": agent facilitates a beneficiary
  // hospital visit and collects the resulting medical report/notes. §6.3
  // notes this leverages Two-Way Beneficiary Relay for scheduling — not
  // yet built, so this checklist stands on its own until that lands.
  [ServiceType.HEALTHCARE_COORDINATION]: [
    'Confirm beneficiary details and hospital/clinic location',
    'Confirm appointment time and attending doctor, if scheduled',
    'Accompany or facilitate beneficiary at the hospital visit',
    'Photograph relevant documentation (admission, prescriptions, receipts)',
    'Collect the medical report / doctor\'s notes',
    'Confirm signed doctor\'s notes are present and legible',
    'Record observations',
    'Identify exceptions',
    'Complete healthcare coordination submission',
  ],
};
