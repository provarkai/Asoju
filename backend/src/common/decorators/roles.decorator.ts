import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Declares which roles may call a handler. Role membership alone is never
 * sufficient for case-scoped resources — pair with @UseGuards(CaseAccessGuard)
 * wherever a specific case/customer record is being read or written
 * (Non-Negotiable #6). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
