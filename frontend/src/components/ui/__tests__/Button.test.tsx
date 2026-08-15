import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../Button';

// Design-system spec §5 "Button system" — "Every button needs an
// accessible name... Loading state must preserve button dimensions."

describe('Button', () => {
  it('renders with an accessible name from its children', () => {
    render(<Button>Start a request</Button>);
    expect(screen.getByRole('button', { name: 'Start a request' })).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Sign in</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disables the button and sets aria-busy while loading, without removing the accessible name', () => {
    render(<Button loading>Submitting</Button>);
    const button = screen.getByRole('button', { name: 'Submitting' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('does not fire onClick while loading (prevents duplicate submission)', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Pay now
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pay now' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
