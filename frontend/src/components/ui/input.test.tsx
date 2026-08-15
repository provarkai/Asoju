import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from './input';
import { Textarea } from './textarea';
import { Label } from './label';

describe('Input', () => {
  it('accepts typed input and reports it via onChange', async () => {
    const onChange = vi.fn();
    render(<Input aria-label="Email" onChange={onChange} />);

    const input = screen.getByLabelText('Email');
    await userEvent.type(input, 'diaspora@example.com');

    expect(input).toHaveValue('diaspora@example.com');
    expect(onChange).toHaveBeenCalled();
  });

  it('is disabled when disabled is set', () => {
    render(<Input aria-label="Email" disabled />);
    expect(screen.getByLabelText('Email')).toBeDisabled();
  });

  it('pairs with a Label via htmlFor/id', () => {
    render(
      <>
        <Label htmlFor="email">Email</Label>
        <Input id="email" />
      </>,
    );
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });
});

describe('Textarea', () => {
  it('accepts multi-line typed input', async () => {
    render(<Textarea aria-label="Notes" />);
    const textarea = screen.getByLabelText('Notes');

    await userEvent.type(textarea, 'Line one{enter}Line two');

    expect(textarea).toHaveValue('Line one\nLine two');
  });
});
