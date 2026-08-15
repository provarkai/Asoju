import { HTMLAttributes } from 'react';

// Design-system spec §7 "Status system" — "Exact status values must be
// mapped to actual backend enums. The visual system should support the
// state without requiring every possible state to be hard-coded into
// every screen." Badge is the one shared visual primitive; the
// CASE_STATUS_TONE/PAYMENT_STATUS_TONE maps below are the real backend
// enum values (backend/prisma/schema.prisma — see
// docs/FRONTEND_HANDOFF_V1_GAP_MAP.md §3), so case/quote/payment screens
// (Sprint 8/9) plug straight into this instead of re-deriving colors.
//
// Status is never communicated by color alone (§19 accessibility
// contract) — every Badge also renders its text label.

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_STYLE: Record<BadgeTone, { background: string; color: string }> = {
  neutral: { background: 'var(--asoju-neutral-bg)', color: 'var(--asoju-muted)' },
  info: { background: 'var(--asoju-info-bg)', color: 'var(--asoju-info)' },
  success: { background: 'var(--asoju-success-bg)', color: 'var(--asoju-success)' },
  warning: { background: 'var(--asoju-warning-bg)', color: 'var(--asoju-warning)' },
  danger: { background: 'var(--asoju-danger-bg)', color: 'var(--asoju-danger)' },
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className, style, ...rest }: BadgeProps) {
  return <span className={['badge', className].filter(Boolean).join(' ')} style={{ ...TONE_STYLE[tone], ...style }} {...rest} />;
}

/** Real CaseStatus values (backend/prisma/schema.prisma). Labels are
 * customer-facing defaults — override per-screen where the handoff's
 * copy differs; the tone mapping is what stays authoritative here. */
export const CASE_STATUS_TONE: Record<string, { tone: BadgeTone; label: string }> = {
  DRAFT: { tone: 'neutral', label: 'Draft' },
  SUBMITTED: { tone: 'neutral', label: 'Submitted' },
  UNDER_REVIEW: { tone: 'info', label: 'Under review' },
  QUOTED: { tone: 'info', label: 'Quote ready' },
  AWAITING_PAYMENT: { tone: 'warning', label: 'Payment required' },
  SCHEDULED: { tone: 'info', label: 'Scheduled' },
  ASSIGNED: { tone: 'info', label: 'Assigned' },
  IN_PROGRESS: { tone: 'info', label: 'In progress' },
  EVIDENCE_SUBMITTED: { tone: 'info', label: 'Evidence submitted' },
  QUALITY_CONTROL: { tone: 'info', label: 'In review' },
  CUSTOMER_REVIEW: { tone: 'warning', label: 'Your review needed' },
  ADDITIONAL_WORK: { tone: 'warning', label: 'Additional work' },
  APPROVED: { tone: 'success', label: 'Approved' },
  COMPLETED: { tone: 'success', label: 'Completed' },
  CLOSED: { tone: 'neutral', label: 'Closed' },
  ON_HOLD: { tone: 'warning', label: 'On hold' },
  DISPUTED: { tone: 'warning', label: 'Disputed' },
};

/** Real PaymentStatus values (backend/prisma/schema.prisma). */
export const PAYMENT_STATUS_TONE: Record<string, { tone: BadgeTone; label: string }> = {
  PENDING: { tone: 'neutral', label: 'Pending' },
  PROCESSING: { tone: 'info', label: 'Processing' },
  PAID: { tone: 'success', label: 'Paid' },
  FAILED: { tone: 'danger', label: 'Failed' },
  EXPIRED: { tone: 'danger', label: 'Expired' },
  REFUNDED: { tone: 'neutral', label: 'Refunded' },
  PARTIALLY_REFUNDED: { tone: 'neutral', label: 'Partially refunded' },
  RECONCILIATION_REQUIRED: { tone: 'warning', label: 'Under review' },
};

export function StatusBadge({ map, status, ...rest }: { map: Record<string, { tone: BadgeTone; label: string }>; status: string } & Omit<BadgeProps, 'tone' | 'children'>) {
  const entry = map[status] ?? { tone: 'neutral' as const, label: status };
  return (
    <Badge tone={entry.tone} {...rest}>
      {entry.label}
    </Badge>
  );
}
