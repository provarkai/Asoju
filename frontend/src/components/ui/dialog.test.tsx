import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './dialog';

function ExampleDialog() {
  return (
    <Dialog>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm request</DialogTitle>
          <DialogDescription>This will submit your request to a representative.</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog', () => {
  it('is closed until the trigger is clicked, then shows its content', async () => {
    render(<ExampleDialog />);

    expect(screen.queryByText('Confirm request')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Confirm request')).toBeInTheDocument();
    expect(screen.getByText('This will submit your request to a representative.')).toBeInTheDocument();
  });

  it('closes when the close button is activated', async () => {
    render(<ExampleDialog />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
