import { BadRequestException } from '@nestjs/common';
import { CaseStatus } from '@prisma/client';

/**
 * Section 5.2 — deterministic, backend-enforced case state machine.
 * AI may recommend a transition but this map is the only thing that can
 * ever authorise one (Non-Negotiable #9: "AI cannot independently move a
 * case between critical states — only the deterministic workflow engine
 * can, based on validated triggers.").
 *
 * Golden path:
 *   Draft -> Submitted -> Under Review -> Quoted -> Awaiting Payment ->
 *   Scheduled -> Assigned -> In Progress -> Evidence Submitted ->
 *   Quality Control -> Customer Review -> (Additional Work | Approved) ->
 *   Completed -> Closed
 *
 * Plus: QC rework loops back to In Progress, Additional Work loops back to
 * In Progress, an unaccepted expired quote loops QUOTED back to Under
 * Review (CommerceService.runQuoteExpirySweep — a quote validity window
 * that's lapsed should let staff re-quote, not leave the case stuck), and
 * any pre-execution state can be cancelled to Closed.
 *
 * ON_HOLD and DISPUTED are both deliberately absent from this map entirely
 * — neither appears as a `to` for any status, and neither has a real entry
 * of its own as a `from` (so `TRANSITIONS[ON_HOLD|DISPUTED] ?? []` always
 * rejects). The only way in or out of either is a dedicated service method
 * (holdCase/resumeCase, raiseDispute/resolveDispute) that manages the
 * status directly, not the generic POST /transition — same reasoning for
 * both: what they resolve to isn't a fixed edge a static map should own
 * (ON_HOLD resumes to wherever the case was before, per-case; DISPUTED
 * always resolves to ADDITIONAL_WORK, but resolveDispute also needs to
 * mutate the Dispute record in the same operation, which this map can't
 * express either way).
 */
const TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  [CaseStatus.DRAFT]: [CaseStatus.SUBMITTED, CaseStatus.CLOSED],
  [CaseStatus.SUBMITTED]: [CaseStatus.UNDER_REVIEW, CaseStatus.CLOSED],
  [CaseStatus.UNDER_REVIEW]: [CaseStatus.QUOTED, CaseStatus.CLOSED],
  [CaseStatus.QUOTED]: [CaseStatus.AWAITING_PAYMENT, CaseStatus.UNDER_REVIEW, CaseStatus.CLOSED],
  [CaseStatus.AWAITING_PAYMENT]: [CaseStatus.SCHEDULED, CaseStatus.CLOSED],
  [CaseStatus.SCHEDULED]: [CaseStatus.ASSIGNED, CaseStatus.CLOSED],
  [CaseStatus.ASSIGNED]: [CaseStatus.IN_PROGRESS, CaseStatus.SCHEDULED],
  [CaseStatus.IN_PROGRESS]: [CaseStatus.EVIDENCE_SUBMITTED],
  [CaseStatus.EVIDENCE_SUBMITTED]: [CaseStatus.QUALITY_CONTROL],
  [CaseStatus.QUALITY_CONTROL]: [CaseStatus.CUSTOMER_REVIEW, CaseStatus.IN_PROGRESS],
  [CaseStatus.CUSTOMER_REVIEW]: [CaseStatus.ADDITIONAL_WORK, CaseStatus.APPROVED],
  [CaseStatus.ADDITIONAL_WORK]: [CaseStatus.IN_PROGRESS],
  [CaseStatus.APPROVED]: [CaseStatus.COMPLETED],
  [CaseStatus.COMPLETED]: [CaseStatus.CLOSED],
  [CaseStatus.CLOSED]: [],
  // Never reachable via this map — see the ON_HOLD/DISPUTED comment above.
  [CaseStatus.ON_HOLD]: [],
  [CaseStatus.DISPUTED]: [],
};

export function assertValidTransition(from: CaseStatus, to: CaseStatus): void {
  const allowed = TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new BadRequestException(
      `Invalid case transition: ${from} -> ${to}. Allowed from ${from}: ${allowed.join(', ') || '(none — terminal state)'}`,
    );
  }
}

export function getAllowedTransitions(from: CaseStatus): CaseStatus[] {
  return TRANSITIONS[from] ?? [];
}
