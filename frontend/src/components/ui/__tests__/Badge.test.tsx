import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CASE_STATUS_TONE, PAYMENT_STATUS_TONE, StatusBadge } from '../Badge';

// Design-system spec §19 accessibility contract — "Status is never
// communicated through color alone" — every StatusBadge must render its
// text label regardless of tone. §7 "Status system" — real backend enum
// values (backend/prisma/schema.prisma CaseStatus/PaymentStatus) map to
// a tone, not the other way around.

describe('StatusBadge', () => {
  it('renders every mapped CaseStatus value with visible text, not color alone', () => {
    for (const [status, { label }] of Object.entries(CASE_STATUS_TONE)) {
      const { unmount } = render(<StatusBadge map={CASE_STATUS_TONE} status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders every mapped PaymentStatus value with visible text', () => {
    for (const [status, { label }] of Object.entries(PAYMENT_STATUS_TONE)) {
      const { unmount } = render(<StatusBadge map={PAYMENT_STATUS_TONE} status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('falls back to the raw status string for an unmapped value instead of throwing', () => {
    render(<StatusBadge map={CASE_STATUS_TONE} status="SOME_FUTURE_STATUS" />);
    expect(screen.getByText('SOME_FUTURE_STATUS')).toBeInTheDocument();
  });
});
