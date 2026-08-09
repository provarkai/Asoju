'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';

interface Rm { id: string; email: string | null }
interface CustomerRow {
  id: string;
  fullName: string;
  user: { email: string | null };
  assignedRm: Rm | null;
  subscriptions: { status: string; tier: string }[];
}

// Section 12 P1 "Concierge workflow" — admin assigns a Relationship
// Manager to each Concierge-subscribed customer's portfolio.
export default function OpsConciergePage() {
  const { ready } = useOpsGuard();
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [rms, setRms] = useState<Rm[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<CustomerRow[]>('/concierge/customers').then(setCustomers).catch((e) => setError(e.message));
    apiFetch<Rm[]>('/concierge/relationship-managers').then(setRms).catch(() => {});
  }

  useEffect(() => {
    if (ready) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function assign(customerId: string, rmUserId: string) {
    if (!rmUserId) return;
    try {
      await apiFetch(`/concierge/customers/${customerId}/rm`, {
        method: 'PATCH',
        body: JSON.stringify({ rmUserId }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign RM');
    }
  }

  if (!ready) return null;

  return (
    <div>
      <div className="hero">
        <h1>Concierge</h1>
        <p>Every customer, their subscription status, and who owns their relationship.</p>
      </div>

      {error && <p className="error-text">{error}</p>}
      {rms.length === 0 && (
        <p className="muted">No Relationship Manager accounts exist yet — provision one via Prisma/psql to assign portfolios.</p>
      )}

      <div className="card">
        {customers === null && <p className="muted">Loading…</p>}
        {customers && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--asoju-border)' }}>
                <th style={{ padding: '0.4rem' }}>Customer</th>
                <th style={{ padding: '0.4rem' }}>Subscription</th>
                <th style={{ padding: '0.4rem' }}>Relationship Manager</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const sub = c.subscriptions[0];
                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--asoju-border)' }}>
                    <td style={{ padding: '0.4rem' }}>
                      <Link href={`/ops/customers/${c.id}`}>{c.fullName}</Link> <span className="muted">({c.user.email})</span>
                    </td>
                    <td style={{ padding: '0.4rem' }}>
                      {sub ? <span className="badge">{sub.tier} · {sub.status.toLowerCase()}</span> : <span className="muted">Essential</span>}
                    </td>
                    <td style={{ padding: '0.4rem' }}>
                      <select
                        value={c.assignedRm?.id ?? ''}
                        onChange={(e) => assign(c.id, e.target.value)}
                        disabled={rms.length === 0}
                      >
                        <option value="">Unassigned</option>
                        {rms.map((rm) => (
                          <option key={rm.id} value={rm.id}>{rm.email}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
