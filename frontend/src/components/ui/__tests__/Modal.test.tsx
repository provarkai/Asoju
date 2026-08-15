import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../Modal';

// Design-system spec §13 "Modal, drawer and overlay system" — focus trap,
// Escape to close, return focus to the triggering control on close.

function OpenableModal({ onCloseSpy }: { onCloseSpy: () => void }) {
  return (
    <>
      <button>Open menu</button>
      <Modal open onClose={onCloseSpy} title="Menu">
        <button>First action</button>
        <button>Second action</button>
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('renders nothing when closed', () => {
    const onClose = vi.fn();
    render(<Modal open={false} onClose={onClose} title="Menu">content</Modal>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders as an accessible dialog labeled by its title when open, and moves focus inside', async () => {
    const onClose = vi.fn();
    render(<OpenableModal onCloseSpy={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('calls onClose on Escape', async () => {
    const onClose = vi.fn();
    render(<OpenableModal onCloseSpy={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when the close button is activated', async () => {
    const onClose = vi.fn();
    render(<OpenableModal onCloseSpy={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
