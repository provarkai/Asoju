'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';
import { humanCaseStatus, humanServiceType } from '@/lib/case-status';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ flex: '1 1 12rem' }}>
      <div className="muted" style={{ fontSize: '0.8rem' }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

interface CaseSummary {
  id: string;
  caseNumber: string;
  serviceType: string;
  status: string;
  tier: string;
  createdAt: string;
  paidAmount: number;
  rating: { stars: number; comment: string | null } | null;
}

interface CustomerHistory {
  customer: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    customerSince: string;
    referralCode: string;
  };
  stats: {
    totalCases: number;
    completedCases: number;
    totalPaid: number;
    averageRating: number | null;
  };
  cases: CaseSummary[];
}

// Section 12 P1 "customer service history" — a staff member's single view
// of a customer's whole relationship with ASOJU, not just what's currently
// open in the queue.
export default function CustomerHistoryPage() {
  const { ready } = useOpsGuard();
  const params = useParams<{ id: string }>();
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    apiFetch<CustomerHistory>(`/customers/${params.id}/history`)
      .then(setHistory)
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, params.id]);

  if (!ready) return null;
  if (error) return <p className="error-text">{error}</p>;
  if (!history) return <p className="muted">Loading…</p>;

  const { customer, stats, cases } = history;

  return (
    <div>
      <div className="hero">
        <h1>{customer.fullName}</h1>
        <p>
          {customer.email ?? customer.phone} · customer since{' '}
          {new Date(customer.customerSince).toLocaleDateString()} · referral code{' '}
          <code>{customer.referralCode}</code>
        </p>
      </div>

      <div className="actions-row" style={{ flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <Stat label="Total cases" value={String(stats.totalCases)} />
        <Stat label="Completed" value={String(stats.completedCases)} />
        <Stat label="Total paid" value={`₦${stats.totalPaid.toLocaleString()}`} />
        <Stat label="Average rating" value={stats.averageRating ? `${stats.averageRating.toFixed(1)}★` : '—'} />
      </div>

      <div className="card">
        <h2>Case history</h2>
        {cases.length === 0 && <p className="muted">No cases yet.</p>}
        {cases.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--asoju-border)' }}>
                <th style={{ padding: '0.4rem' }}>Case</th>
                <th style={{ padding: '0.4rem' }}>Service</th>
                <th style={{ padding: '0.4rem' }}>Status</th>
                <th style={{ padding: '0.4rem' }}>Tier</th>
                <th style={{ padding: '0.4rem' }}>Paid</th>
                <th style={{ padding: '0.4rem' }}>Rating</th>
                <th style={{ padding: '0.4rem' }}>Opened</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--asoju-border)' }}>
                  <td style={{ padding: '0.4rem' }}>
                    <Link href={`/ops/cases/${c.id}`}>{c.caseNumber}</Link>
                  </td>
                  <td style={{ padding: '0.4rem' }}>{humanServiceType(c.serviceType)}</td>
                  <td style={{ padding: '0.4rem' }}>{humanCaseStatus(c.status)}</td>
                  <td style={{ padding: '0.4rem' }}>{c.tier}</td>
                  <td style={{ padding: '0.4rem' }}>₦{c.paidAmount.toLocaleString()}</td>
                  <td style={{ padding: '0.4rem' }}>{c.rating ? `${c.rating.stars} ★` : '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
