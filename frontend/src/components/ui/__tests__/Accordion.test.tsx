import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Accordion } from '../Accordion';

describe('Accordion', () => {
  const items = [
    { question: 'What areas do you cover?', answer: 'Lagos, Abuja and environs.' },
    { question: 'How fast is the first visit?', answer: 'Typically within 48 hours.' },
  ];

  it('starts with every panel collapsed', () => {
    render(<Accordion items={items} />);
    for (const item of items) {
      expect(screen.getByRole('button', { name: item.question })).toHaveAttribute('aria-expanded', 'false');
    }
  });

  it('expands a panel on click and exposes it via aria-expanded/aria-controls', async () => {
    render(<Accordion items={items} />);
    const trigger = screen.getByRole('button', { name: items[0].question });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(items[0].answer)).toBeVisible();
  });

  it('collapses the previously open panel when a new one opens (single-open mode)', async () => {
    render(<Accordion items={items} />);
    await userEvent.click(screen.getByRole('button', { name: items[0].question }));
    await userEvent.click(screen.getByRole('button', { name: items[1].question }));
    expect(screen.getByRole('button', { name: items[0].question })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: items[1].question })).toHaveAttribute('aria-expanded', 'true');
  });
});
