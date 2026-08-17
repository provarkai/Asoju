import { ApprovalAction } from '@prisma/client';

/// Platform Expansion PRD §6.1 "Deeper WhatsApp-first case approval" —
/// encodes which case + which ApprovalAction a button represents directly
/// into the button id, since a WhatsApp thread has no other notion of
/// "which case is this reply about" the way the AI concierge's
/// conversation history does. The BSP echoes the id back verbatim on
/// reply (interactive.button_reply.id in the standard WhatsApp Business
/// Cloud API shape) — this is just that round-trip, encode/decode.
const PREFIX = 'case-approval';

const ACTION_BY_CODE: Record<string, ApprovalAction> = {
  approve: ApprovalAction.APPROVED,
  additional_work: ApprovalAction.REQUEST_ADDITIONAL_WORK,
};
const CODE_BY_ACTION: Partial<Record<ApprovalAction, string>> = {
  [ApprovalAction.APPROVED]: 'approve',
  [ApprovalAction.REQUEST_ADDITIONAL_WORK]: 'additional_work',
};

export function buildCaseApprovalButtons(caseId: string): { id: string; title: string }[] {
  return [
    { id: `${PREFIX}:${CODE_BY_ACTION[ApprovalAction.APPROVED]}:${caseId}`, title: 'Approve report' },
    { id: `${PREFIX}:${CODE_BY_ACTION[ApprovalAction.REQUEST_ADDITIONAL_WORK]}:${caseId}`, title: 'Request changes' },
  ];
}

export function parseCaseApprovalButtonId(id: string): { action: ApprovalAction; caseId: string } | null {
  const parts = id.split(':');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, code, caseId] = parts;
  const action = ACTION_BY_CODE[code];
  if (!action || !caseId) return null;
  return { action, caseId };
}
