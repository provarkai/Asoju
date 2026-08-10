/**
 * Section 5.1 — case detail page must show "status in human language (not
 * internal state codes)". This is the single translation point; nothing
 * else in the UI should print a raw CaseStatus value.
 */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Getting your request ready',
  SUBMITTED: 'Submitted — awaiting review',
  UNDER_REVIEW: 'Our team is reviewing your request',
  QUOTED: 'Quote ready for your review',
  AWAITING_PAYMENT: 'Awaiting payment',
  SCHEDULED: 'Visit scheduled',
  ASSIGNED: 'Agent assigned',
  IN_PROGRESS: 'Work in progress',
  EVIDENCE_SUBMITTED: 'Evidence submitted — pending quality check',
  QUALITY_CONTROL: 'Under quality review',
  CUSTOMER_REVIEW: 'Ready for your review',
  ADDITIONAL_WORK: 'Additional work requested',
  APPROVED: 'Approved',
  COMPLETED: 'Completed',
  CLOSED: 'Closed',
  ON_HOLD: 'On hold',
};

const SERVICE_TYPE_LABELS: Record<string, string> = {
  PROPERTY_INSPECTION: 'Property Inspection & Verification',
  CONSTRUCTION_SUPERVISION: 'Construction / Project Supervision',
  ASSET_INSPECTION: 'Asset / Project Inspection',
  FAMILY_SUPPORT: 'Family Support',
  PROCUREMENT: 'Procurement',
  BUSINESS_VERIFICATION: 'Business Verification',
  INVESTMENT_SUPPORT: 'Investment Support',
  AGRICULTURE_SUPPORT: 'Agriculture Support',
};

const APPROVAL_ACTION_LABELS: Record<string, string> = {
  APPROVED: 'Approved',
  REQUEST_CLARIFICATION: 'Requested clarification',
  REQUEST_ADDITIONAL_WORK: 'Requested additional work',
  ESCALATE: 'Escalated',
};

export function humanCaseStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function humanServiceType(serviceType: string): string {
  return SERVICE_TYPE_LABELS[serviceType] ?? serviceType;
}

export function humanApprovalAction(action: string): string {
  return APPROVAL_ACTION_LABELS[action] ?? action;
}
