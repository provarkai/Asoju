'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';

interface RefundRequestRow {
  id: string;
  paymentId: string;
  amount: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedBy: { email: string };
  decidedBy: { email: string } | null;
  decisionNote: string | null;
  createdAt: string;
  payment: { amount: string; currency: string; providerReference: string };
}

// P0 Security, Privacy & Trust Architecture v1.0 §8 "Privileged Action
// Matrix" — "Refund | Finance permission + threshold approval where
// configured." A refund above REFUND_APPROVAL_THRESHOLD_NGN lands here
// instead of executing immediately — a second, different Finance/Admin
// actor must approve or reject it (maker-checker, enforced server-side).
export default function RefundApprovalsPage() {
  const { user, ready } = useOpsGuard();
  const [requests, setRequests] = useState<RefundRequestRow[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState<Record<string, string>>({});

  function load() {
    setError(null);
    const query = statusFilter === 'PENDING' ? '?status=PENDING' : '';
    apiFetch<RefundRequestRow[]>(`/admin/refund-requests${query}`)
      .then(setRequests)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load refund requests'));
  }

  useEffect(() => {
    if (ready) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, statusFilter]);

  async function decide(id: string, action: 'approve' | 'reject') {
    setBusy(id);
    setError(null);
    try {
      await apiFetch(`/admin/refund-requests/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ note: decisionNote[id] || undefined }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  if (!ready) return null;

  return (
    <div>
      <div className="hero">
        <h1>Refund approvals</h1>
        <p className="muted">
          Refunds above the configured threshold need a second, different Finance approver before any
          money moves — you can&apos;t approve or reject your own request.
        </p>
      </div>

      <div className="actions-row" style={{ marginBottom: '1rem' }}>
        <button className={`btn ${statusFilter === 'PENDING' ? '' : 'btn--ghost'}`} onClick={() => setStatusFilter('PENDING')}>
          Pending
        </button>
        <button className={`btn ${statusFilter === 'ALL' ? '' : 'btn--ghost'}`} onClick={() => setStatusFilter('ALL')}>
          All
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        {requests === null && <p className="muted">Loading…</p>}
        {requests && requests.length === 0 && <p className="muted">Nothing here.</p>}
        {requests && requests.length > 0 && (
          <div className="case-list">
            {requests.map((r) => (
              <div key={r.id} className="case-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}>
                <div className="actions-row" style={{ justifyContent: 'space-between' }}>
                  <span>
                    {r.payment.currency} {Number(r.amount).toLocaleString()} · {r.payment.providerReference}
                  </span>
                  <span className={r.status === 'PENDING' ? 'badge' : r.status === 'REJECTED' ? 'badge badge--error' : 'badge'}>
                    {r.status}
                  </span>
                </div>
                <span className="muted">Requested by {r.requestedBy.email} — &ldquo;{r.reason}&rdquo;</span>
                {r.decidedBy && (
                  <span className="muted">
                    Decided by {r.decidedBy.email}
                    {r.decisionNote && ` — "${r.decisionNote}"`}
                  </span>
                )}
                {r.status === 'PENDING' && (
                  <div className="actions-row">
                    <input
                      placeholder="Note (optional)"
                      value={decisionNote[r.id] ?? ''}
                      onChange={(e) => setDecisionNote((n) => ({ ...n, [r.id]: e.target.value }))}
                      style={{ flex: 1 }}
                    />
                    {user && user.email === r.requestedBy.email ? (
                      <span className="muted">Awaiting a different Finance approver — you requested this one.</span>
                    ) : (
                      <>
                        <button
                          className="btn btn--secondary"
                          disabled={busy !== null}
                          onClick={() => decide(r.id, 'approve')}
                        >
                          {busy === r.id ? 'Working…' : 'Approve'}
                        </button>
                        <button className="btn btn--ghost" disabled={busy !== null} onClick={() => decide(r.id, 'reject')}>
                          {busy === r.id ? 'Working…' : 'Reject'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
