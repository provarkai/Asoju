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
 * ON_HOLD is deliberately absent from this map entirely — it never appears
 * as a `to` for any status, and has no entry of its own as a `from` (so
 * `TRANSITIONS[ON_HOLD] ?? []` always rejects). Where a held case resumes
 * *to* is dynamic (wherever it was before, per-case), not a fixed edge a
 * static map can express, so CasesService.holdCase/resumeCase manage that
 * status directly via ServiceCase.heldFromStatus rather than through this
 * generic transition — the only way in or out of ON_HOLD.
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
  // Never reachable via this map — see the ON_HOLD comment above.
  [CaseStatus.ON_HOLD]: [],
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
