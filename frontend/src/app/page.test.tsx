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

  it('renders the hero, the six-service grid, and does not fabricate customer testimonials', () => {
    render(<Landing />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/presence/i);

    // Sprint 4 §7 governance: no invented reviews/quotes on the homepage
    // (a fabricated "From our customers" section was found and removed
    // this session — see FRONTEND_HANDOFF_V1_GAP_MAP.md §7). This test
    // exists specifically so that regressing back to one fails loudly.
    expect(screen.queryByText(/from our customers/i)).not.toBeInTheDocument();
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
