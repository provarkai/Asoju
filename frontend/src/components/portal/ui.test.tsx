import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorState } from './ui';

// Regression guard for the customer portal's one systemic navigation gap
// this session found: every page's failed-fetch state used to be bare
// <p className="error-text"> with no way forward except a manual
// browser refresh. ErrorState is the fix — this locks in that it shows
// the actual error and that "Try again" really calls the retry.
describe('ErrorState', () => {
  it('shows the error message and calls onRetry when "Try again" is clicked', async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Failed to load your dashboard" onRetry={onRetry} />);

    expect(screen.getByText('Failed to load your dashboard')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
