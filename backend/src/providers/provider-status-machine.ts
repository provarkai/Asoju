import { BadRequestException } from '@nestjs/common';
import { ProviderStatus } from '@prisma/client';

/**
 * Provider verification lifecycle (Gate 2 — Trust & Provider Network,
 * working-session source doc): Pending -> Under Review -> Verified ->
 * Active -> Restricted/Suspended -> Removed. Kept just as deliberate as
 * the case state machine — a provider's trust status is exactly the kind
 * of thing Non-Negotiable #3 ("no high-risk conclusion without appropriate
 * human review") depends on being accurate.
 */
const TRANSITIONS: Record<ProviderStatus, ProviderStatus[]> = {
  [ProviderStatus.PENDING]: [ProviderStatus.UNDER_REVIEW, ProviderStatus.REMOVED],
  [ProviderStatus.UNDER_REVIEW]: [ProviderStatus.VERIFIED, ProviderStatus.REMOVED],
  [ProviderStatus.VERIFIED]: [ProviderStatus.ACTIVE, ProviderStatus.RESTRICTED, ProviderStatus.SUSPENDED],
  [ProviderStatus.ACTIVE]: [ProviderStatus.RESTRICTED, ProviderStatus.SUSPENDED],
  [ProviderStatus.RESTRICTED]: [ProviderStatus.ACTIVE, ProviderStatus.SUSPENDED, ProviderStatus.REMOVED],
  [ProviderStatus.SUSPENDED]: [ProviderStatus.ACTIVE, ProviderStatus.RESTRICTED, ProviderStatus.REMOVED],
  [ProviderStatus.REMOVED]: [],
};

export function assertValidProviderTransition(from: ProviderStatus, to: ProviderStatus): void {
  const allowed = TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new BadRequestException(
      `Invalid provider status transition: ${from} -> ${to}. Allowed from ${from}: ${allowed.join(', ') || '(none — terminal state)'}`,
    );
  }
}
