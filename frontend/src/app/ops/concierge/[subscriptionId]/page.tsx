'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';
import { ADMIN_ROLES } from '@/lib/roles';

interface ScLedgerRow {
  id: string;
  type: 'GRANT' | 'DEBIT' | 'REVERSAL' | 'ADJUSTMENT' | 'EXPIRY';
  amountUsd: string;
  amountNgn: string | null;
  caseId: string | null;
  reason: string | null;
  createdAt: string;
}

// P0 UX Spec "Finance Screen — SC Ledger": "No manual balance edits
// without an auditable adjustment." Every row here is append-only.
export default function ScLedgerPage() {
  const { user, ready } = useOpsGuard();
  const params = useParams<{ subscriptionId: string }>();
  const [ledger, setLedger] = useState<ScLedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amountUsd, setAmountUsd] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const canAdjust = user ? ADMIN_ROLES.includes(user.role) || user.role === 'FINANCE' : false;

  function load() {
    apiFetch<ScLedgerRow[]>(`/admin/subscriptions/${params.subscriptionId}/sc-ledger`)
      .then(setLedger)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load SC ledger'));
  }

  useEffect(() => {
    if (ready) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const balance = ledger
    ? ledger.reduce((sum, e) => {
        const amt = Number(e.amountUsd);
        if (e.type === 'GRANT' || e.type === 'REVERSAL') return sum + amt;
        if (e.type === 'DEBIT' || e.type === 'EXPIRY') return sum - amt;
        return sum + amt; // ADJUSTMENT is signed
      }, 0)
    : null;

  async function submitAdjustment() {
    if (!amountUsd || !reason) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/admin/subscriptions/${params.subscriptionId}/sc-adjustment`, {
        method: 'POST',
        body: JSON.stringify({ amountUsd: Number(amountUsd), reason }),
      });
      setAmountUsd('');
      setReason('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adjustment failed');
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return null;

  return (
    <div>
      <div className="hero">
        <h1>SC Ledger</h1>
        <p className="muted">Append-only — every credit, debit, reversal and adjustment on this membership.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="muted" style={{ fontSize: '0.8rem' }}>Current balance</div>
        <div style={{ fontSize: '2rem', fontWeight: 700 }}>{balance === null ? '—' : `$${balance.toFixed(2)}`}</div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        {ledger === null ? (
          <p className="muted">Loading…</p>
        ) : ledger.length === 0 ? (
          <p className="muted">No ledger entries yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--asoju-border)' }}>
                <th style={{ padding: '0.4rem' }}>Type</th>
                <th style={{ padding: '0.4rem' }}>USD</th>
                <th style={{ padding: '0.4rem' }}>NGN applied</th>
                <th style={{ padding: '0.4rem' }}>Reason</th>
                <th style={{ padding: '0.4rem' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--asoju-border)' }}>
                  <td style={{ padding: '0.4rem' }}><span className="badge">{e.type}</span></td>
                  <td style={{ padding: '0.4rem' }}>${Number(e.amountUsd).toFixed(2)}</td>
                  <td style={{ padding: '0.4rem' }}>{e.amountNgn ? `₦${Number(e.amountNgn).toLocaleString()}` : '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{e.reason ?? '—'}</td>
                  <td style={{ padding: '0.4rem' }}>{new Date(e.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canAdjust && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Manual adjustment</h2>
          <p className="muted">
            A signed correction — negative to remove SC, positive to add it. Always requires a reason and is
            recorded on the ledger above, never a silent balance edit.
          </p>
          <div className="actions-row" style={{ flexWrap: 'wrap' }}>
            <input
              type="number"
              placeholder="Amount USD (e.g. -10 or 25)"
              value={amountUsd}
              onChange={(e) => setAmountUsd(e.target.value)}
            />
            <input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="btn" disabled={busy || !amountUsd || !reason} onClick={submitAdjustment}>
              {busy ? 'Submitting…' : 'Apply adjustment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
