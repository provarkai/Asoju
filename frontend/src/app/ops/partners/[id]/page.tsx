'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';
import { humanCaseStatus, humanServiceType } from '@/lib/case-status';

interface CaseSummary {
  id: string;
  caseNumber: string;
  serviceType: string;
  status: string;
  createdAt: string;
  paidAmount: number;
}
interface ReferredCustomer {
  id: string;
  fullName: string;
  email: string | null;
  customerSince: string;
  cases: CaseSummary[];
}
interface PartnerDetail {
  partner: { id: string; name: string; code: string; type: string; status: string };
  referredCustomers: ReferredCustomer[];
}

export default function OpsPartnerDetailPage() {
  const { ready } = useOpsGuard();
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<PartnerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    apiFetch<PartnerDetail>(`/partners/${params.id}`).then(setDetail).catch((e) => setError(e.message));
  }, [ready, params.id]);

  if (!ready) return null;
  if (error) return <p className="error-text">{error}</p>;
  if (!detail) return <p className="muted">Loading…</p>;

  const totalPaid = detail.referredCustomers.reduce(
    (sum, c) => sum + c.cases.reduce((s, cs) => s + cs.paidAmount, 0),
    0,
  );

  return (
    <div>
      <div className="hero">
        <h1>{detail.partner.name}</h1>
        <p className="muted">
          {detail.partner.type} · code <code>{detail.partner.code}</code> · {detail.partner.status.toLowerCase()}
        </p>
      </div>

      <div className="actions-row" style={{ marginBottom: '1.5rem' }}>
        <div className="card" style={{ flex: '1 1 12rem' }}>
          <div className="muted" style={{ fontSize: '0.8rem' }}>Referred customers</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{detail.referredCustomers.length}</div>
        </div>
        <div className="card" style={{ flex: '1 1 12rem' }}>
          <div className="muted" style={{ fontSize: '0.8rem' }}>Total paid</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>₦{totalPaid.toLocaleString()}</div>
        </div>
      </div>

      {detail.referredCustomers.length === 0 && (
        <p className="muted">No customers have registered with this partner&apos;s code yet.</p>
      )}
      {detail.referredCustomers.map((customer) => (
        <div key={customer.id} className="card">
          <h2 style={{ marginTop: 0 }}>
            <Link href={`/ops/customers/${customer.id}`}>{customer.fullName}</Link>{' '}
            <span className="muted" style={{ fontWeight: 400 }}>({customer.email})</span>
          </h2>
          {customer.cases.length === 0 && <p className="muted">No cases yet.</p>}
          {customer.cases.map((c) => (
            <div key={c.id} className="case-row">
              <Link href={`/ops/cases/${c.id}`}>{c.caseNumber}</Link>
              <span className="muted">{humanServiceType(c.serviceType)}</span>
              <span className="badge">{humanCaseStatus(c.status)}</span>
              <span className="muted">₦{c.paidAmount.toLocaleString()} paid</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
