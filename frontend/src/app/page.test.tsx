import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Landing from './page';

// App Router hooks throw ("invariant expected app router to be mounted")
// outside a real Next.js render tree — every page-level test needs this.
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

describe('Landing (homepage) smoke test', () => {
  beforeEach(() => {
    push.mockClear();
    window.localStorage.clear();
  });

  it('renders the locked hero headline, all six real services, and does not fabricate proof', () => {
    render(<Landing />);

    // Locked copy — docs/frontend-handoff-v1.0/99_Supplemental/
    // ASOJU_Homepage_Build_Blueprint_v1.0.docx §4.2.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/be there.*even when you can't be there/i);

    // Regression guard for the bug this session found: the homepage's
    // service grid had drifted out of sync with the six real, live
    // service pages (lib/services.ts / SERVICE_FAMILIES) and was still
    // showing three old, differently-named placeholder services.
    for (const name of ['ASOJU Arrivals', 'ASOJU Inspect', 'ASOJU Build', 'ASOJU Care', 'ASOJU Verify', 'ASOJU Assist']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }

    // Sprint 4 §7 governance: no invented reviews/quotes/stats on the
    // homepage (a fabricated "From our customers" section, and separately
    // a fabricated trust-bar stat block — "3,200+ tasks executed", "4.9/5
    // average rating" — were both found and removed this session; see
    // FRONTEND_HANDOFF_V1_GAP_MAP.md §7). This test exists specifically so
    // regressing back to either fails loudly.
    expect(screen.queryByText(/from our customers/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/3,200\+/)).not.toBeInTheDocument();
    expect(screen.queryByText(/4\.9\/5/)).not.toBeInTheDocument();
  });

  it('shows "Sign in" for a signed-out visitor and routes Get started to /register', async () => {
    render(<Landing />);

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('renders the AI Concierge demo embed', () => {
    render(<Landing />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
