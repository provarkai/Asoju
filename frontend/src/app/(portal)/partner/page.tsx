'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { usePartnerGuard } from '@/lib/usePartnerGuard';
import { humanCaseStatus, humanServiceType } from '@/lib/case-status';

interface CaseSummary {
  id: string;
  caseNumber: string;
  serviceType: string;
  status: string;
  createdAt: string;
}
interface ReferredCustomer {
  id: string;
  fullName: string;
  customerSince: string;
  cases: CaseSummary[];
}
interface PartnerDashboard {
  partner: { name: string; code: string; type: string };
  referredCustomers: ReferredCustomer[];
}

// Section 12 P2 "partner portal" — a partner contact's own read-only view
// of who they've referred. No financials (that stays staff-only) and no
// case detail beyond status — this is visibility, not access.
export default function PartnerDashboardPage() {
  const { ready } = usePartnerGuard();
  const [dashboard, setDashboard] = useState<PartnerDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    apiFetch<PartnerDashboard>('/partner/dashboard').then(setDashboard).catch((e) => setError(e.message));
  }, [ready]);

  if (!ready) return null;
  if (error) return <p className="error-text">{error}</p>;
  if (!dashboard) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="hero">
        <h1>{dashboard.partner.name}</h1>
        <p>
          Your referral code is <span className="badge" style={{ fontSize: '1rem' }}>{dashboard.partner.code}</span> —
          share <code>asoju.example/register?partner={dashboard.partner.code}</code> so new customers are attributed to you.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Customers you&apos;ve referred</h2>
        {dashboard.referredCustomers.length === 0 && (
          <p className="muted">Nobody has registered with your code yet.</p>
        )}
        {dashboard.referredCustomers.map((customer) => (
          <div key={customer.id} style={{ marginTop: '1rem' }}>
            <strong>{customer.fullName}</strong>{' '}
            <span className="muted">
              since {new Date(customer.customerSince).toLocaleDateString()} · {customer.cases.length} case
              {customer.cases.length === 1 ? '' : 's'}
            </span>
            {customer.cases.map((c) => (
              <div key={c.id} className="case-row">
                <span className="muted">{c.caseNumber} · {humanServiceType(c.serviceType)}</span>
                <span className="badge">{humanCaseStatus(c.status)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
