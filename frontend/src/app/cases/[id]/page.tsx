'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { humanApprovalAction, humanCaseStatus, humanServiceType } from '@/lib/case-status';

interface StatusHistoryEntry {
  id: string;
  toStatus: string;
  reason: string | null;
  createdAt: string;
}

interface EvidenceEntry {
  id: string;
  type: string;
  description: string | null;
  evidenceLevel: string;
  trustLabel: string;
}

interface ReportEntry {
  id: string;
  summary: string;
  createdAt: string;
}

interface ApprovalEntry {
  id: string;
  action: string;
  note: string | null;
  createdAt: string;
}

interface QuoteEntry {
  id: string;
  amount: string;
  currency: string;
  acceptedAt: string | null;
}

interface CaseDetail {
  id: string;
  caseNumber: string;
  serviceType: string;
  status: string;
  priority: string;
  location: string;
  description: string;
  paymentStatus: string;
  statusHistory: StatusHistoryEntry[];
  evidence: EvidenceEntry[];
  reports: ReportEntry[];
  approvals: ApprovalEntry[];
  quotes: QuoteEntry[];
}

const APPROVAL_ACTIONS: { action: string; label: string; variant: 'btn' | 'btn--secondary' }[] = [
  { action: 'APPROVED', label: 'Approve', variant: 'btn' },
  { action: 'REQUEST_CLARIFICATION', label: 'Request clarification', variant: 'btn--secondary' },
  { action: 'REQUEST_ADDITIONAL_WORK', label: 'Request additional work', variant: 'btn--secondary' },
  { action: 'ESCALATE', label: 'Escalate', variant: 'btn--secondary' },
];

export default function CaseDetailPage() {
  const { ready } = useAuthGuard();
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);

  function load() {
    apiFetch<CaseDetail>(`/cases/${params.id}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load case'));
  }

  useEffect(() => {
    if (!ready) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, params.id]);

  async function submitApproval(action: string) {
    setSubmitting(action);
    try {
      await apiFetch(`/cases/${params.id}/approvals`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(null);
    }
  }

  async function acceptQuote(quoteId: string) {
    setSubmitting('accept-quote');
    try {
      await apiFetch(`/quotes/${quoteId}/accept`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept quote');
    } finally {
      setSubmitting(null);
    }
  }

  if (!ready) return null;
  if (error) return <p className="error-text">{error}</p>;
  if (!detail) return <p className="muted">Loading…</p>;

  const canReview = detail.status === 'CUSTOMER_REVIEW';

  return (
    <div>
      <div className="hero">
        <h1>{detail.caseNumber}</h1>
        <p>
          {humanServiceType(detail.serviceType)} · {detail.location}
        </p>
        <span className="badge">{humanCaseStatus(detail.status)}</span>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>What you asked us to do</h2>
        <p>{detail.description}</p>
      </div>

      {detail.quotes.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Quote</h2>
          {detail.quotes.map((q) => (
            <div key={q.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <strong>
                  {q.currency} {Number(q.amount).toLocaleString()}
                </strong>
                {q.acceptedAt && (
                  <div className="muted">Accepted {new Date(q.acceptedAt).toLocaleString()}</div>
                )}
              </div>
              {!q.acceptedAt && detail.status === 'QUOTED' && (
                <button className="btn" disabled={submitting !== null} onClick={() => acceptQuote(q.id)}>
                  {submitting === 'accept-quote' ? 'Accepting…' : 'Accept & proceed to payment'}
                </button>
              )}
              {q.acceptedAt && detail.paymentStatus !== 'PAID' && (
                <span className="badge">Awaiting payment</span>
              )}
              {detail.paymentStatus === 'PAID' && <span className="badge">Paid</span>}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Timeline</h2>
        <ul className="timeline">
          {detail.statusHistory.map((h) => (
            <li key={h.id}>
              <strong>{humanCaseStatus(h.toStatus)}</strong>
              <div className="muted">{new Date(h.createdAt).toLocaleString()}</div>
              {h.reason && <div className="muted">{h.reason}</div>}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Evidence</h2>
        {detail.evidence.length === 0 ? (
          <p className="muted">No evidence submitted yet.</p>
        ) : (
          <ul>
            {detail.evidence.map((e) => (
              <li key={e.id}>
                <strong>{e.type}</strong> — {e.description ?? 'No description'}{' '}
                <span className="muted">
                  ({e.evidenceLevel.replace('_', ' ').toLowerCase()}, {e.trustLabel.replace(/_/g, ' ').toLowerCase()})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Report</h2>
        {detail.reports.length === 0 ? (
          <p className="muted">Your report will appear here once quality control is complete.</p>
        ) : (
          detail.reports.map((r) => (
            <div key={r.id}>
              <p>{r.summary}</p>
              <p className="muted">{new Date(r.createdAt).toLocaleString()}</p>
            </div>
          ))
        )}
      </div>

      {canReview && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Your decision</h2>
          <p className="muted">Review the report above, then let us know how you&apos;d like to proceed.</p>
          <div className="actions-row">
            {APPROVAL_ACTIONS.map((a) => (
              <button
                key={a.action}
                className={`btn ${a.variant === 'btn--secondary' ? 'btn--secondary' : ''}`}
                disabled={submitting !== null}
                onClick={() => submitApproval(a.action)}
              >
                {submitting === a.action ? 'Submitting…' : a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {detail.approvals.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Decision history</h2>
          <ul>
            {detail.approvals.map((a) => (
              <li key={a.id}>
                {humanApprovalAction(a.action)} — <span className="muted">{new Date(a.createdAt).toLocaleString()}</span>
                {a.note && <div className="muted">{a.note}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
