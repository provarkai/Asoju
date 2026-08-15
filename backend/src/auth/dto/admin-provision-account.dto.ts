import { IsEmail, IsIn } from 'class-validator';
import { Role } from '@prisma/client';

/** Section 5.7 "Admin Console" — the roles this endpoint is allowed to
 * provision. Deliberately excludes CUSTOMER (self-service /auth/register),
 * BENEFICIARY (invite-only, ProfileService.inviteBeneficiary), FIELD_AGENT
 * and PROVIDER (their own onboarding at /ops/agents, /ops/providers — see
 * AgentsController/ProvidersController), and PARTNER (provisioned via
 * POST /admin/partners/:partnerId/contacts instead, since a partner login
 * always needs a Partner to attach to). */
export const PROVISIONABLE_STAFF_ROLES = [
  Role.RELATIONSHIP_MANAGER,
  Role.CASE_MANAGER,
  Role.QUALITY_CONTROL,
  Role.FINANCE,
  Role.COMPLIANCE_RISK,
  Role.ADMIN,
  Role.SUPER_ADMIN,
] as const;

export class CreateStaffAccountDto {
  @IsEmail()
  email: string;

  @IsIn(PROVISIONABLE_STAFF_ROLES)
  role: (typeof PROVISIONABLE_STAFF_ROLES)[number];
}
