'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';
import { humanCaseStatus, humanServiceType } from '@/lib/case-status';

interface AssignmentSummary {
  role: string;
  status: string;
  agent: { fullName: string } | null;
  provider: { fullName: string } | null;
}

interface CaseQueueRow {
  id: string;
  caseNumber: string;
  serviceType: string;
  status: string;
  priority: string;
  location: string;
  paymentStatus: string;
  customerId: string;
  customer: { fullName: string };
  assignments: AssignmentSummary[];
  _count: { riskFlags: number; incidents: number };
  updatedAt: string;
}

interface ServiceRequestRow {
  id: string;
  rawDescription: string;
  location: string | null;
  channel: string;
  leadTag: string | null;
  createdAt: string;
}

const FILTERS: { key: string; label: string; match: (c: CaseQueueRow) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  {
    key: 'triage',
    label: 'Needs triage',
    match: (c) => ['SUBMITTED', 'UNDER_REVIEW'].includes(c.status),
  },
  { key: 'payment', label: 'Awaiting payment', match: (c) => c.status === 'AWAITING_PAYMENT' },
  { key: 'assignment', label: 'Needs assignment', match: (c) => c.status === 'SCHEDULED' },
  {
    key: 'progress',
    label: 'In progress',
    match: (c) => ['ASSIGNED', 'IN_PROGRESS'].includes(c.status),
  },
  {
    key: 'qc',
    label: 'Needs QC',
    match: (c) => ['EVIDENCE_SUBMITTED', 'QUALITY_CONTROL'].includes(c.status),
  },
  { key: 'review', label: 'Customer review', match: (c) => c.status === 'CUSTOMER_REVIEW' },
  {
    key: 'escalations',
    label: 'Escalations',
    match: (c) => c._count.riskFlags > 0 || c._count.incidents > 0,
  },
  {
    key: 'done',
    label: 'Completed',
    match: (c) => ['COMPLETED', 'CLOSED'].includes(c.status),
  },
];

export default function OpsQueuePage() {
  const { ready } = useOpsGuard();
  const [cases, setCases] = useState<CaseQueueRow[] | null>(null);
  const [requests, setRequests] = useState<ServiceRequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [claiming, setClaiming] = useState<string | null>(null);

  function load() {
    apiFetch<CaseQueueRow[]>('/cases')
      .then(setCases)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the queue'));
    apiFetch<ServiceRequestRow[]>('/service-requests')
      .then(setRequests)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load new requests'));
  }

  useEffect(() => {
    if (ready) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const filtered = useMemo(() => (cases ?? []).filter(activeFilter.match), [cases, activeFilter]);

  async function claim(caseId: string) {
    setClaiming(caseId);
    try {
      await apiFetch(`/cases/${caseId}/claim`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim case');
    } finally {
      setClaiming(null);
    }
  }

  if (!ready) return null;

  return (
    <div>
      <div className="hero">
        <h1>Case queue</h1>
        <p>Every case in the system — claim one to open it, or drill straight in if you&apos;re already on it.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      {requests && requests.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>New requests — needs triage</h2>
          <p className="muted">Raw AI Concierge / manual intake, not yet a case.</p>
          <div className="case-list">
            {requests.map((r) => (
              <Link key={r.id} href={`/ops/requests/${r.id}`} className="case-row">
                <div className="case-row__meta">
                  <strong>{r.rawDescription}</strong>
                  <span className="muted">{r.location ?? 'No location given'} · via {r.channel}</span>
                </div>
                <span className="badge">Convert →</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="actions-row" style={{ marginBottom: '1rem' }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`btn ${filter === f.key ? '' : 'btn--ghost'}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label} {cases ? `(${cases.filter(f.match).length})` : ''}
          </button>
        ))}
      </div>

      <div className="card">
        {cases === null && <p className="muted">Loading…</p>}
        {cases && filtered.length === 0 && <p className="muted">Nothing here.</p>}
        {cases && filtered.length > 0 && (
          <div className="case-list">
            {filtered.map((c) => {
              const assignee = c.assignments[0];
              return (
                <div key={c.id} className="case-row">
                  <div className="case-row__meta">
                    <Link href={`/ops/cases/${c.id}`}>
                      <strong>{c.caseNumber}</strong>
                    </Link>
                    <span className="muted">
                      <Link href={`/ops/customers/${c.customerId}`}>{c.customer.fullName}</Link>
                      {' '}· {humanServiceType(c.serviceType)} · {c.location}
                    </span>
                    {assignee && (
                      <span className="muted">
                        Assigned to {assignee.agent?.fullName ?? assignee.provider?.fullName} ({assignee.status.toLowerCase()})
                      </span>
                    )}
                    {(c._count.riskFlags > 0 || c._count.incidents > 0) && (
                      <span className="error-text">
                        {c._count.riskFlags} risk flag(s), {c._count.incidents} incident(s)
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span className="badge">{humanCaseStatus(c.status)}</span>
                    <button
                      className="btn btn--ghost"
                      disabled={claiming !== null}
                      onClick={() => claim(c.id)}
                    >
                      {claiming === c.id ? 'Claiming…' : 'Claim'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
