import { Button } from './Button';

// Shared "something went wrong" panel — used by every route's error.tsx
// (Next.js app-router error-boundary convention) and inline for
// per-request failures, so recovery/retry behavior is consistent across
// screens rather than each page inventing its own copy. Design-system
// spec: Sprint 1 "error-boundary primitives"; §15 route inventory
// requires an explicit "Server error" + "Retry/recovery" state on every
// data-dependent screen.

export function ErrorState({
  title = 'Something went wrong',
  message = "That didn't load. Your data is safe — try again.",
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="card" role="alert" style={{ textAlign: 'center' }}>
      <h2 style={{ margin: '0 0 0.5rem' }}>{title}</h2>
      <p className="muted" style={{ margin: '0 auto 1.25rem', maxWidth: '32rem' }}>
        {message}
      </p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
