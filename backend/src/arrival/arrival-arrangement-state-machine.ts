import { BadRequestException } from '@nestjs/common';
import { ArrivalArrangementStatus } from '@prisma/client';

/**
 * ASOJU_Arrivals_Service_Page_Blueprint_v1.1's locked state machine for a
 * transport/accommodation arrangement, backend/provider-authoritative:
 * "the frontend should never imply guaranteed availability before
 * confirmation." Same deterministic, backend-enforced pattern as
 * cases/case-state-machine.ts.
 *
 *   Requested -> Being Sourced -> Awaiting Confirmation -> Confirmed ->
 *   (Changed | Cancelled | Completed)
 *
 * CHANGED loops back to AWAITING_CONFIRMATION — a confirmed booking that
 * changes (different flight, different driver, a room swap) needs the
 * customer-visible status to go back to "not yet confirmed" until the new
 * detail is itself confirmed, never stay CONFIRMED against stale detail.
 * CANCELLED and COMPLETED are both terminal — a cancelled or completed
 * arrangement is re-requested as a new ArrivalArrangement, not reopened.
 */
const TRANSITIONS: Record<ArrivalArrangementStatus, ArrivalArrangementStatus[]> = {
  [ArrivalArrangementStatus.REQUESTED]: [ArrivalArrangementStatus.BEING_SOURCED, ArrivalArrangementStatus.CANCELLED],
  [ArrivalArrangementStatus.BEING_SOURCED]: [
    ArrivalArrangementStatus.AWAITING_CONFIRMATION,
    ArrivalArrangementStatus.CANCELLED,
  ],
  [ArrivalArrangementStatus.AWAITING_CONFIRMATION]: [
    ArrivalArrangementStatus.CONFIRMED,
    ArrivalArrangementStatus.CANCELLED,
  ],
  [ArrivalArrangementStatus.CONFIRMED]: [
    ArrivalArrangementStatus.CHANGED,
    ArrivalArrangementStatus.CANCELLED,
    ArrivalArrangementStatus.COMPLETED,
  ],
  [ArrivalArrangementStatus.CHANGED]: [
    ArrivalArrangementStatus.AWAITING_CONFIRMATION,
    ArrivalArrangementStatus.CANCELLED,
  ],
  [ArrivalArrangementStatus.CANCELLED]: [],
  [ArrivalArrangementStatus.COMPLETED]: [],
};

/** A reason is required moving *into* either of these — never a silent
 * cancellation or a silent "this changed", same discipline as
 * ServiceCase.holdCase's required `reason`. */
const NOTE_REQUIRED_STATUSES = new Set<ArrivalArrangementStatus>([
  ArrivalArrangementStatus.CANCELLED,
  ArrivalArrangementStatus.CHANGED,
]);

export function assertValidArrangementTransition(
  from: ArrivalArrangementStatus,
  to: ArrivalArrangementStatus,
  note?: string,
): void {
  const allowed = TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new BadRequestException(
      `Invalid arrival arrangement transition: ${from} -> ${to}. Allowed from ${from}: ${allowed.join(', ') || '(none — terminal state)'}`,
    );
  }
  if (NOTE_REQUIRED_STATUSES.has(to) && !note?.trim()) {
    throw new BadRequestException(`note is required moving an arrangement to ${to}`);
  }
}

export function getAllowedArrangementTransitions(from: ArrivalArrangementStatus): ArrivalArrangementStatus[] {
  return TRANSITIONS[from] ?? [];
}
