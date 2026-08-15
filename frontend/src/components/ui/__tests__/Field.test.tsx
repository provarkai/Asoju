import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input, Textarea } from '../Field';

// Design-system spec §6 "Form system" — "Do not rely on placeholder text
// as the only label" — and §19 accessibility contract — "error messages
// are associated with their controls."

describe('Input', () => {
  it('associates the visible label with the control programmatically', () => {
    render(<Input label="Email" />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('marks the field invalid and associates the error message via aria-describedby', () => {
    render(<Input label="Email" error="Enter a valid email address" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const errorEl = document.getElementById(describedBy!);
    expect(errorEl).toHaveTextContent('Enter a valid email address');
    expect(errorEl).toHaveAttribute('role', 'alert');
  });

  it('shows the hint instead of stealing space from an error when there is none', () => {
    render(<Input label="Phone" hint="Include country code" />);
    expect(screen.getByText('Include country code')).toBeInTheDocument();
  });
});

describe('Textarea', () => {
  it('associates label and error the same way as Input', () => {
    render(<Textarea label="What do you need done?" error="Tell us a bit more" />);
    const textarea = screen.getByLabelText('What do you need done?');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Tell us a bit more');
  });
});
