'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { humanCaseStatus, humanServiceType } from '@/lib/case-status';

interface CaseSummary {
  id: string;
  caseNumber: string;
  serviceType: string;
  status: string;
  priority: string;
  location: string;
  createdAt: string;
}

interface ServiceRequestSummary {
  id: string;
  rawDescription: string;
  convertedCaseId: string | null;
  createdAt: string;
}

// Section 5.1 — Case dashboard: active cases, action-required items, recent
// reports, payments awaiting approval.
export default function DashboardPage() {
  const { ready } = useAuthGuard();
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [requests, setRequests] = useState<ServiceRequestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    Promise.all([
      apiFetch<CaseSummary[]>('/cases'),
      apiFetch<ServiceRequestSummary[]>('/service-requests'),
    ])
      .then(([c, r]) => {
        setCases(c);
        setRequests(r.filter((req) => !req.convertedCaseId));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load your cases'));
  }, [ready]);

  if (!ready) return null;

  return (
    <div>
      <div className="hero">
        <h1>Your cases</h1>
        <p>Everything you&apos;ve asked ASOJU to handle in Nigeria, in one place.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      {requests && requests.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Pending review</h2>
          <p className="muted">
            These requests are with our team and haven&apos;t become a case yet — no action needed
            from you right now.
          </p>
          <div className="case-list">
            {requests.map((r) => (
              <div key={r.id} className="case-row">
                <div className="case-row__meta">
                  <strong>{r.rawDescription}</strong>
                  <span className="muted">Submitted {new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
                <span className="badge">Under review</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Active &amp; past cases</h2>
        {cases === null && <p className="muted">Loading…</p>}
        {cases && cases.length === 0 && (
          <p className="muted">
            No cases yet. Use the concierge on the home page to tell us what you need handled.
          </p>
        )}
        {cases && cases.length > 0 && (
          <div className="case-list">
            {cases.map((c) => (
              <Link key={c.id} href={`/cases/${c.id}`} className="case-row">
                <div className="case-row__meta">
                  <strong>{c.caseNumber}</strong>
                  <span className="muted">
                    {humanServiceType(c.serviceType)} · {c.location}
                  </span>
                </div>
                <span className="badge">{humanCaseStatus(c.status)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
