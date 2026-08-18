// Section 5.3 — Operations Control Centre is for internal staff roles only.
export const OPS_ROLES = [
  'CASE_MANAGER',
  'RELATIONSHIP_MANAGER',
  'QUALITY_CONTROL',
  'FINANCE',
  'COMPLIANCE_RISK',
  'ADMIN',
  'SUPER_ADMIN',
];

export const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

// Matches backend ConciergeController's FINANCE_ROLES — who can edit
// membership plan pricing (P0 UX Spec "Admin Screen — Pricing Configuration").
export const FINANCE_ROLES = ['FINANCE', 'ADMIN', 'SUPER_ADMIN'];

// Matches backend CasesController's CHECKLIST_STAFF_ROLES — who can add,
// edit, or remove a case-specific checklist item on top of the fixed
// service-type template.
export const CHECKLIST_STAFF_ROLES = ['CASE_MANAGER', 'ADMIN', 'SUPER_ADMIN'];

// Matches backend ArrivalArrangementsController's ARRIVAL_STAFF_ROLES —
// who can create/transition a transport/accommodation arrangement.
export const ARRIVAL_STAFF_ROLES = ['CASE_MANAGER', 'RELATIONSHIP_MANAGER', 'ADMIN', 'SUPER_ADMIN'];

// Section 5.4 — Field Agent App / Provider Portal (shared workflow for MVP).
export const FIELD_ROLES = ['FIELD_AGENT', 'PROVIDER'];

// Section 12 P2 — Partner portal.
export const PARTNER_ROLES = ['PARTNER'];

// "Who is a Beneficiary" (portal access) — the person a Customer names on
// a case, given their own limited, read-only login.
export const BENEFICIARY_ROLES = ['BENEFICIARY'];

export function landingPathForRole(role: string): string {
  if (OPS_ROLES.includes(role)) return '/ops';
  if (FIELD_ROLES.includes(role)) return '/field';
  if (PARTNER_ROLES.includes(role)) return '/partner';
  if (BENEFICIARY_ROLES.includes(role)) return '/beneficiary';
  return '/dashboard';
}
