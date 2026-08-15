import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './badge';

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge>Most popular</Badge>);
    expect(screen.getByText('Most popular')).toBeInTheDocument();
  });

  it('defaults to the default variant classes', () => {
    render(<Badge>Default</Badge>);
    expect(screen.getByText('Default')).toHaveClass('bg-primary');
  });

  it('applies the outline variant classes', () => {
    render(<Badge variant="outline">Outline</Badge>);
    const badge = screen.getByText('Outline');
    expect(badge).not.toHaveClass('bg-primary');
    expect(badge).toHaveClass('text-foreground');
  });

  it('asChild renders as the child element (e.g. a link badge)', () => {
    render(
      <Badge asChild>
        <a href="/pricing">Recurring visits</a>
      </Badge>,
    );
    expect(screen.getByRole('link', { name: 'Recurring visits' })).toHaveAttribute('href', '/pricing');
  });
});
