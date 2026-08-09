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

export function landingPathForRole(role: string): string {
  if (OPS_ROLES.includes(role)) return '/ops';
  return '/dashboard';
}
