import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './button';

describe('Button', () => {
  it('renders its children and fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Get started</Button>);

    const button = screen.getByRole('button', { name: 'Get started' });
    await userEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled and inert when disabled is set', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Get started
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Get started' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies the destructive variant class', () => {
    render(<Button variant="destructive">Delete</Button>);
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-destructive');
  });

  it('asChild renders the child element instead of a <button>, with the same classes', () => {
    render(
      <Button asChild>
        <a href="/dashboard">Open portal</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Open portal' });
    expect(link).toHaveAttribute('href', '/dashboard');
    expect(link).toHaveClass('inline-flex');
  });
});
