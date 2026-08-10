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
  limitation: string | null;
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

interface ScopeEntry {
  id: string;
  version: number;
  objective: string;
  tasks: string[];
  deliverables: string[];
  exclusions: string[];
  evidenceRequirements: string[];
  confirmedAt: string | null;
}

interface PaymentEntry {
  id: string;
  status: string;
}

interface InvoiceEntry {
  id: string;
  amount: string;
  currency: string;
  payments: PaymentEntry[];
}

interface RatingEntry {
  stars: number;
  comment: string | null;
}

interface DocumentEntry {
  id: string;
  label: string;
  uploadedById: string | null;
  createdAt: string;
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
  documents: DocumentEntry[];
  reports: ReportEntry[];
  approvals: ApprovalEntry[];
  quotes: QuoteEntry[];
  invoices: InvoiceEntry[];
  rating: RatingEntry | null;
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
  const [ratingStars, setRatingStars] = useState(5);
  const [ratingComment, setRatingComment] = useState('');
  const [documentLabel, setDocumentLabel] = useState('');
  const [documentRef, setDocumentRef] = useState('');
  const [scope, setScope] = useState<ScopeEntry | null>(null);

  function load() {
    apiFetch<CaseDetail>(`/cases/${params.id}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load case'));
    apiFetch<ScopeEntry | null>(`/cases/${params.id}/scope`).then(setScope).catch(() => {});
  }

  async function confirmScope() {
    setSubmitting('confirm-scope');
    try {
      await apiFetch(`/cases/${params.id}/scope/confirm`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm scope');
    } finally {
      setSubmitting(null);
    }
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

  async function addDocument() {
    setSubmitting('document');
    try {
      await apiFetch(`/cases/${params.id}/documents`, {
        method: 'POST',
        body: JSON.stringify({ label: documentLabel, storageKey: documentRef }),
      });
      setDocumentLabel('');
      setDocumentRef('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add document');
    } finally {
      setSubmitting(null);
    }
  }

  async function submitRating() {
    setSubmitting('rating');
    try {
      await apiFetch(`/cases/${params.id}/rating`, {
        method: 'POST',
        body: JSON.stringify({ stars: ratingStars, comment: ratingComment || undefined }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit rating');
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

  async function payInvoice(invoiceId: string) {
    setSubmitting('pay');
    try {
      const result = await apiFetch<{ authorizationUrl: string; dryRun: boolean }>(
        `/invoices/${invoiceId}/pay`,
        { method: 'POST' },
      );
      if (result.dryRun) {
        setError(null);
        window.alert(
          `Test mode — no Paystack account configured yet. In production you'd be redirected to:\n${result.authorizationUrl}`,
        );
      } else {
        window.location.href = result.authorizationUrl;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start payment');
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

      {scope && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Scope of work</h2>
          <p className="muted">Exactly what&apos;s included before you see a price.</p>
          <p><strong>{scope.objective}</strong></p>
          <ul>
            {scope.tasks.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
          {scope.deliverables.length > 0 && (
            <>
              <p style={{ marginBottom: '0.25rem' }}><strong>You&apos;ll receive:</strong></p>
              <ul>{scope.deliverables.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </>
          )}
          {scope.exclusions.length > 0 && (
            <>
              <p style={{ marginBottom: '0.25rem' }}><strong>Not included:</strong></p>
              <ul>{scope.exclusions.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </>
          )}
          {scope.confirmedAt ? (
            <p className="muted">Confirmed {new Date(scope.confirmedAt).toLocaleDateString()}.</p>
          ) : (
            <>
              <p>Work won&apos;t be quoted until you confirm this is what you want done.</p>
              <button className="btn" disabled={submitting !== null} onClick={confirmScope}>
                {submitting === 'confirm-scope' ? 'Confirming…' : 'Confirm scope'}
              </button>
            </>
          )}
        </div>
      )}

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
              {q.acceptedAt && detail.paymentStatus !== 'PAID' && (() => {
                const invoice = detail.invoices.find((inv) => inv.amount === q.amount) ?? detail.invoices[0];
                const pending = invoice && !invoice.payments.some((p) => p.status === 'PAID');
                const lastFailed = invoice?.payments.length
                  ? invoice.payments[invoice.payments.length - 1].status === 'FAILED'
                  : false;
                return invoice && pending ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
                    {lastFailed && <span className="error-text">Your last payment attempt didn&apos;t go through.</span>}
                    <button className="btn" disabled={submitting !== null} onClick={() => payInvoice(invoice.id)}>
                      {submitting === 'pay' ? 'Starting payment…' : lastFailed ? 'Try payment again' : 'Pay now'}
                    </button>
                  </div>
                ) : (
                  <span className="badge">Awaiting payment</span>
                );
              })()}
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
        <h2 style={{ marginTop: 0 }}>Documents</h2>
        <p className="muted">Title docs, ID copies, receipts — anything you want on file against this case.</p>
        {detail.documents.length > 0 && (
          <ul>
            {detail.documents.map((d) => (
              <li key={d.id}>{d.label} — <span className="muted">{new Date(d.createdAt).toLocaleDateString()}</span></li>
            ))}
          </ul>
        )}
        <div className="actions-row">
          <input placeholder="Label" value={documentLabel} onChange={(e) => setDocumentLabel(e.target.value)} />
          <input
            placeholder="File reference (upload integration pending)"
            value={documentRef}
            onChange={(e) => setDocumentRef(e.target.value)}
          />
          <button className="btn btn--secondary" disabled={!documentLabel || !documentRef || submitting !== null} onClick={addDocument}>
            {submitting === 'document' ? 'Adding…' : 'Add document'}
          </button>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Report</h2>
        {detail.reports.length === 0 ? (
          <p className="muted">Your report will appear here once quality control is complete.</p>
        ) : (
          detail.reports.map((r) => (
            <div key={r.id}>
              <p>{r.summary}</p>
              {r.limitation && (
                <p className="muted">
                  <strong>Noted limitation:</strong> {r.limitation}
                </p>
              )}
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

      {(detail.status === 'COMPLETED' || detail.status === 'CLOSED') && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Rate this service</h2>
          {detail.rating ? (
            <p>
              You rated this {detail.rating.stars} / 5{detail.rating.comment ? ` — “${detail.rating.comment}”` : ''}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '28rem' }}>
              <div className="actions-row">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    className={`btn ${ratingStars === n ? '' : 'btn--ghost'}`}
                    onClick={() => setRatingStars(n)}
                  >
                    {n}★
                  </button>
                ))}
              </div>
              <input
                placeholder="Any comments? (optional)"
                value={ratingComment}
                onChange={(e) => setRatingComment(e.target.value)}
              />
              <button
                className="btn"
                style={{ alignSelf: 'flex-start' }}
                disabled={submitting !== null}
                onClick={submitRating}
              >
                {submitting === 'rating' ? 'Submitting…' : 'Submit rating'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
