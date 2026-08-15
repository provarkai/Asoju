'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';

interface AuditEvent {
  id: string;
  actorId: string | null;
  actor: { id: string; email: string | null; role: string } | null;
  actorType: string;
  action: string;
  caseId: string | null;
  case: { id: string; caseNumber: string } | null;
  metadata: unknown;
  createdAt: string;
}

interface SearchResult {
  events: AuditEvent[];
  total: number;
  take: number;
  skip: number;
}

const PAGE_SIZE = 50;

// Admin Console & Platform Admin Architecture v1.0 Section 26 "Audit Log"
// (P0 MVP screen A20) — every material action is already recorded
// (AuditService.record, called throughout the app); this is where any of
// it becomes actually searchable. Admin/SuperAdmin only, matching the
// backend's @Roles gate on GET /admin/audit-events.
export default function OpsAuditLogPage() {
  const { ready } = useOpsGuard();
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [caseId, setCaseId] = useState('');
  const [actorId, setActorId] = useState('');
  const [action, setAction] = useState('');
  const [actorType, setActorType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [skip, setSkip] = useState(0);

  function load(nextSkip = skip) {
    const params = new URLSearchParams({ take: String(PAGE_SIZE), skip: String(nextSkip) });
    if (caseId) params.set('caseId', caseId);
    if (actorId) params.set('actorId', actorId);
    if (action) params.set('action', action);
    if (actorType) params.set('actorType', actorType);
    if (from) params.set('from', new Date(from).toISOString());
    if (to) params.set('to', new Date(to).toISOString());

    apiFetch<SearchResult>(`/admin/audit-events?${params.toString()}`)
      .then((res) => {
        setResult(res);
        setSkip(nextSkip);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load audit log'));
  }

  useEffect(() => {
    if (ready) load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (!ready) return null;

  return (
    <div>
      <div className="hero">
        <h1>Audit Log</h1>
        <p className="muted">Every material admin/system action, searchable — append-only, never editable here.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <div className="actions-row" style={{ flexWrap: 'wrap' }}>
          <input placeholder="Case ID" value={caseId} onChange={(e) => setCaseId(e.target.value)} />
          <input placeholder="Actor (user) ID" value={actorId} onChange={(e) => setActorId(e.target.value)} />
          <input placeholder="Action contains…" value={action} onChange={(e) => setAction(e.target.value)} />
          <select value={actorType} onChange={(e) => setActorType(e.target.value)}>
            <option value="">Any actor type</option>
            <option value="user">User</option>
            <option value="ai">AI</option>
            <option value="system">System</option>
          </select>
          <label className="muted" style={{ fontSize: '0.8rem' }}>
            From
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="muted" style={{ fontSize: '0.8rem' }}>
            To
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="btn" onClick={() => load(0)}>Search</button>
        </div>
      </div>

      <div className="card">
        {result === null && <p className="muted">Loading…</p>}
        {result && result.events.length === 0 && <p className="muted">No matching events.</p>}
        {result && result.events.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--asoju-border)' }}>
                <th style={{ padding: '0.4rem' }}>When</th>
                <th style={{ padding: '0.4rem' }}>Actor</th>
                <th style={{ padding: '0.4rem' }}>Action</th>
                <th style={{ padding: '0.4rem' }}>Case</th>
              </tr>
            </thead>
            <tbody>
              {result.events.map((e) => (
                <Fragment key={e.id}>
                  <tr
                    style={{ borderBottom: '1px solid var(--asoju-border)', cursor: 'pointer' }}
                    onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                  >
                    <td style={{ padding: '0.4rem' }} className="muted">{new Date(e.createdAt).toLocaleString()}</td>
                    <td style={{ padding: '0.4rem' }}>
                      {e.actor ? `${e.actor.email ?? e.actor.id} (${e.actor.role})` : <span className="badge">{e.actorType}</span>}
                    </td>
                    <td style={{ padding: '0.4rem' }}>{e.action}</td>
                    <td style={{ padding: '0.4rem' }}>
                      {e.case ? <Link href={`/ops/cases/${e.case.id}`}>{e.case.caseNumber}</Link> : <span className="muted">—</span>}
                    </td>
                  </tr>
                  {expandedId === e.id && (
                    <tr>
                      <td colSpan={4} style={{ padding: '0.4rem 0.4rem 1rem' }}>
                        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', margin: 0 }}>
                          {JSON.stringify(e.metadata ?? {}, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        {result && result.total > 0 && (
          <div className="actions-row" style={{ marginTop: '1rem', justifyContent: 'space-between' }}>
            <span className="muted">
              {skip + 1}–{Math.min(skip + PAGE_SIZE, result.total)} of {result.total}
            </span>
            <div className="actions-row">
              <button className="btn btn--ghost" disabled={skip === 0} onClick={() => load(Math.max(0, skip - PAGE_SIZE))}>
                Previous
              </button>
              <button className="btn btn--ghost" disabled={skip + PAGE_SIZE >= result.total} onClick={() => load(skip + PAGE_SIZE)}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
