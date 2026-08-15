'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';

// Next.js app-router error-boundary convention. Design-system spec:
// Sprint 1 "error-boundary primitives" — every route gets this for free
// without a matching more-specific error.tsx of its own.

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div style={{ padding: '3rem 0' }}>
      <ErrorState onRetry={reset} />
    </div>
  );
}
