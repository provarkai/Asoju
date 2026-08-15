'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';

interface PortfolioCustomer {
  id: string;
  fullName: string;
  user: { email: string | null };
  subscriptions: { status: string; tier: string; startedAt: string }[];
  _count: { serviceCases: number };
}

// Section 4 — "Relationship Manager: Assigned customer portfolio (Concierge tier)".
export default function OpsPortfolioPage() {
  const { ready } = useOpsGuard();
  const [customers, setCustomers] = useState<PortfolioCustomer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    apiFetch<PortfolioCustomer[]>('/concierge/portfolio')
      .then(setCustomers)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load portfolio'));
  }, [ready]);

  if (!ready) return null;

  return (
    <div>
      <div className="hero">
        <h1>Your portfolio</h1>
        <p>Concierge customers you&apos;re the dedicated relationship manager for.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        {customers === null && <p className="muted">Loading…</p>}
        {customers && customers.length === 0 && <p className="muted">No customers assigned to you yet.</p>}
        {customers && customers.length > 0 && (
          <ul>
            {customers.map((c) => (
              <li key={c.id} style={{ marginBottom: '0.5rem' }}>
                <strong>{c.fullName}</strong> <span className="muted">({c.user.email})</span> —{' '}
                {c._count.serviceCases} case{c._count.serviceCases === 1 ? '' : 's'}
                {c.subscriptions[0] && (
                  <span className="badge" style={{ marginLeft: '0.5rem' }}>
                    {c.subscriptions[0].tier} · {c.subscriptions[0].status.toLowerCase()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
