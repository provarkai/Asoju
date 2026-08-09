import { Role } from '@prisma/client';

/**
 * "Seeing a case in the queue ≠ having permission to see everything inside
 * the case" (independent readiness review, Section 7.1 follow-up). These
 * staff roles work a case operationally — status, tasks, evidence, QC,
 * invoicing, risk — and don't need the customer's identity to do that job,
 * so they get a curated case file with the name/contact redacted.
 *
 * RELATIONSHIP_MANAGER is deliberately excluded: relationship management is
 * identity-based contact by definition. ADMIN/SUPER_ADMIN are excluded —
 * they already have full access (Section 4). FIELD_AGENT/PROVIDER are
 * governed separately, by document-visibility.ts.
 */
export const PII_RESTRICTED_STAFF_ROLES: Role[] = [
  Role.CASE_MANAGER,
  Role.QUALITY_CONTROL,
  Role.FINANCE,
  Role.COMPLIANCE_RISK,
];

export function isPiiRestricted(role: Role): boolean {
  return PII_RESTRICTED_STAFF_ROLES.includes(role);
}

export const REDACTED_CUSTOMER_NAME = 'Client (name withheld)';

/**
 * Replaces the customer's real name with a fixed placeholder for restricted
 * staff roles; passes through unchanged for everyone else (customer, RM,
 * admin). Never mutates the input — callers assign the result back onto
 * whatever they read it from.
 */
export function redactCustomerName<T extends { fullName: string }>(customer: T, actorRole: Role): T {
  if (!isPiiRestricted(actorRole)) return customer;
  return { ...customer, fullName: REDACTED_CUSTOMER_NAME };
}
