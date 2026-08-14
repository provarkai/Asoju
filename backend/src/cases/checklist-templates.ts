import { MilestoneGroup, ServiceType } from '@prisma/client';

export interface ChecklistItemTemplate {
  label: string;
  /** Platform Expansion PRD §3.3 — only ever set for CONSTRUCTION_
   * SUPERVISION; every other service's items are ungrouped (undefined),
   * same flat checklist as before this field existed. */
  milestoneGroup?: MilestoneGroup;
}

/**
 * Section 6.1 — Standard Field Checklist Pattern. The PRD gives Property
 * Inspection's checklist verbatim and says "every service gets its own
 * version of this pattern" — these are that pattern applied to the other
 * two MVP services, generalized from their Section 6 scope descriptions.
 * Seeded onto a ServiceCase's CaseTask rows at creation (convertToCase).
 */
export const CHECKLIST_TEMPLATES: Record<ServiceType, ChecklistItemTemplate[]> = {
  [ServiceType.PROPERTY_INSPECTION]: [
    { label: 'Confirm location' },
    { label: 'Photograph entrance / access road' },
    { label: 'Photograph surrounding development' },
    { label: 'Photograph the property' },
    { label: 'Capture site video' },
    { label: 'Record observations' },
    { label: 'Collect available documents' },
    { label: 'Identify exceptions' },
    { label: 'Complete inspection submission' },
  ],
  // Platform Expansion PRD §3.3 "Construction Milestone & % Completion
  // Tracker" — "transforms the flat checklist into a milestone-based
  // tracker (Foundation, DPC, Roofing)." Each build-phase gets its own
  // verify+photograph pair, tagged with the matching MilestoneGroup;
  // the closing items (contractor observations, materials, exceptions,
  // submission) apply across the whole visit and stay ungrouped.
  [ServiceType.CONSTRUCTION_SUPERVISION]: [
    { label: 'Confirm site location' },
    { label: 'Verify foundation/footing works against approved plan', milestoneGroup: MilestoneGroup.FOUNDATION },
    { label: 'Photograph foundation/footing progress (all angles)', milestoneGroup: MilestoneGroup.FOUNDATION },
    { label: 'Verify damp-proof course (DPC) / ground floor slab', milestoneGroup: MilestoneGroup.DPC },
    { label: 'Photograph DPC / ground floor slab progress', milestoneGroup: MilestoneGroup.DPC },
    { label: 'Verify superstructure/walling matches approved plan', milestoneGroup: MilestoneGroup.SUPERSTRUCTURE },
    { label: 'Photograph superstructure progress (all angles)', milestoneGroup: MilestoneGroup.SUPERSTRUCTURE },
    { label: 'Verify roofing structure and covering', milestoneGroup: MilestoneGroup.ROOFING },
    { label: 'Photograph roofing progress (all angles)', milestoneGroup: MilestoneGroup.ROOFING },
    { label: 'Verify finishing works (plastering, fittings, painting)', milestoneGroup: MilestoneGroup.FINISHING },
    { label: 'Photograph finishing progress (all angles)', milestoneGroup: MilestoneGroup.FINISHING },
    { label: 'Record contractor observations' },
    { label: 'Verify materials on site' },
    { label: 'Capture progress video' },
    { label: 'Record observations' },
    { label: 'Identify exceptions' },
    { label: 'Complete supervision submission' },
  ],
  [ServiceType.ASSET_INSPECTION]: [
    { label: 'Confirm asset location' },
    { label: 'Photograph the asset (all angles)' },
    { label: 'Capture asset video' },
    { label: 'Record condition observations' },
    { label: 'Collect available documents' },
    { label: 'Identify exceptions' },
    { label: 'Complete inspection submission' },
  ],

  // -- Section 12 P2 service categories -----------------------------------
  // Same standard-checklist pattern (Section 6.1), generalized from each
  // category's one-line scope in Section 1/12 rather than a full new
  // playbook — the platform-expansion services this repo does not (yet)
  // have a dedicated Section 6 write-up for.
  [ServiceType.FAMILY_SUPPORT]: [
    { label: 'Confirm beneficiary details and location' },
    { label: 'Make contact / confirm welfare' },
    { label: 'Photograph relevant documentation' },
    { label: 'Record observations' },
    { label: 'Identify exceptions' },
    { label: 'Complete visit submission' },
  ],
  [ServiceType.PROCUREMENT]: [
    { label: 'Confirm item specification and budget' },
    { label: 'Source and compare at least two quotes' },
    { label: 'Photograph the item(s) before purchase' },
    { label: 'Complete purchase and collect receipt' },
    { label: 'Photograph item(s) and receipt after purchase' },
    { label: 'Arrange delivery / handoff' },
    { label: 'Identify exceptions' },
    { label: 'Complete procurement submission' },
  ],
  [ServiceType.BUSINESS_VERIFICATION]: [
    { label: 'Confirm business name and registered address' },
    { label: 'Photograph business premises' },
    { label: 'Collect CAC / registration documents' },
    { label: 'Record observations on business activity' },
    { label: 'Identify exceptions' },
    { label: 'Complete verification submission' },
  ],
  [ServiceType.INVESTMENT_SUPPORT]: [
    { label: 'Confirm investment site / instrument details' },
    { label: 'Photograph site or supporting documents' },
    { label: 'Record observations' },
    { label: 'Collect available documents' },
    { label: 'Identify exceptions' },
    { label: 'Complete review submission' },
  ],
  [ServiceType.AGRICULTURE_SUPPORT]: [
    { label: 'Confirm farm / site location' },
    { label: 'Photograph the farm (all sections)' },
    { label: 'Capture site video' },
    { label: 'Record crop/livestock condition observations' },
    { label: 'Collect available documents' },
    { label: 'Identify exceptions' },
    { label: 'Complete inspection submission' },
  ],

  // Tier 2 vertical (strategic-suggestions pass) — the most time-critical,
  // emotionally-sensitive service on the catalogue, so the checklist is a
  // vendor-coordination sub-checklist rather than an inspection one:
  // confirming the mortuary/venue/permit chain is actually moving, not
  // photographing a site. See SERVICE_TYPE_DEFAULT_PRIORITY (cases.service.ts)
  // for the accompanying default-urgent SLA override.
  [ServiceType.BEREAVEMENT_SUPPORT]: [
    { label: 'Confirm next of kin / family point of contact' },
    { label: 'Confirm mortuary — location, hold status, and release requirements' },
    { label: 'Confirm burial/venue booking and date' },
    { label: 'Confirm permits and documentation required (death certificate, burial permit)' },
    { label: 'Coordinate with officiant / clergy if requested' },
    { label: 'Record observations' },
    { label: 'Identify exceptions' },
    { label: 'Complete coordination submission' },
  ],

  // Phase 2 "ASOJU Arrival" (Master PRD v2.0 §6.4) — pre-arrival/welcome-
  // home coordination, from the same standard-checklist pattern generalized
  // from the service's scope bullets. ArrivalProfile (arrival.service.ts)
  // carries the structured flight/accommodation detail this checklist's
  // confirmations are actually checking against.
  [ServiceType.ARRIVAL_SUPPORT]: [
    { label: 'Confirm arrival date, flight, and accommodation address against the Arrival Profile' },
    { label: 'Verify accommodation condition and readiness (photos)' },
    { label: 'Confirm utilities / internet active at accommodation' },
    { label: 'Confirm groceries and essentials stocked, if requested' },
    { label: 'Confirm driver / vehicle arranged for airport pickup, if requested' },
    { label: 'Complete airport pickup and meet-and-greet, if requested' },
    { label: 'Record observations' },
    { label: 'Identify exceptions' },
    { label: 'Complete arrival coordination submission' },
  ],

  // Platform Expansion PRD §6.2 "Legal / Document Services Vertical" —
  // "Title Verification" / "CAC Document Retrieval": the agent visits a
  // government registry instead of a physical property, so the standard
  // checklist pattern is generalized to registry visits and certified
  // document handoff rather than site photography.
  [ServiceType.LEGAL_DOCUMENT_SERVICES]: [
    { label: 'Confirm the document(s)/title requested and the issuing registry' },
    { label: 'Confirm any reference numbers, file numbers, or prior correspondence needed for retrieval' },
    { label: 'Visit the registry / government office' },
    { label: 'Photograph the retrieved or verified document(s)' },
    { label: 'Confirm document authenticity markers (seal, signature, watermark) where applicable' },
    { label: 'Collect certified copies / receipts of any fees paid' },
    { label: 'Record observations' },
    { label: 'Identify exceptions' },
    { label: 'Complete legal/document services submission' },
  ],

  // Platform Expansion PRD §6.3 "Healthcare Coordination Vertical" —
  // "Hospital Visit / Medical Checkup": agent facilitates a beneficiary
  // hospital visit and collects the resulting medical report/notes. §6.3
  // notes this leverages Two-Way Beneficiary Relay for scheduling — now
  // built (beneficiary-relay module), not yet wired into this checklist.
  [ServiceType.HEALTHCARE_COORDINATION]: [
    { label: 'Confirm beneficiary details and hospital/clinic location' },
    { label: 'Confirm appointment time and attending doctor, if scheduled' },
    { label: 'Accompany or facilitate beneficiary at the hospital visit' },
    { label: 'Photograph relevant documentation (admission, prescriptions, receipts)' },
    { label: "Collect the medical report / doctor's notes" },
    { label: "Confirm signed doctor's notes are present and legible" },
    { label: 'Record observations' },
    { label: 'Identify exceptions' },
    { label: 'Complete healthcare coordination submission' },
  ],
};
