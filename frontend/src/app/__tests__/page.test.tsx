import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '../page';

// P0 "Frontend test infrastructure" baseline (docs/v2.0-engineering-specs
// Sprint Plan v2.1 §7) — "Add a smoke test proving the application
// renders" before any feature-specific testing. Renders the real
// signed-out homepage (no session in localStorage), not a stub.

describe('HomePage (signed-out)', () => {
  it('renders the marketing landing page with the hero and Concierge preview', async () => {
    render(<HomePage />);
    expect(await screen.findByRole('heading', { name: /your trusted presence back home/i })).toBeInTheDocument();
    expect(screen.getByText('ASOJU AI Concierge — preview')).toBeInTheDocument();
  });

  it('gates formal account creation behind sign-in, not an anonymous action', async () => {
    render(<HomePage />);
    await screen.findByRole('heading', { name: /your trusted presence back home/i });
    expect(screen.getAllByRole('link', { name: /start a request/i })[0]).toHaveAttribute('href', '/register');
  });
});
