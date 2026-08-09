'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';
import { ADMIN_ROLES } from '@/lib/roles';
import { humanCaseStatus, humanServiceType } from '@/lib/case-status';

const CASE_STATUSES = [
  'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'QUOTED', 'AWAITING_PAYMENT', 'SCHEDULED', 'ASSIGNED',
  'IN_PROGRESS', 'EVIDENCE_SUBMITTED', 'QUALITY_CONTROL', 'CUSTOMER_REVIEW', 'ADDITIONAL_WORK',
  'APPROVED', 'COMPLETED', 'CLOSED',
];

interface Agent { id: string; fullName: string; isActive: boolean; city: string | null }
interface Provider { id: string; fullName: string; status: string; serviceCategory: string }

interface CaseDetail {
  id: string;
  caseNumber: string;
  serviceType: string;
  status: string;
  priority: string;
  riskLevel: number;
  location: string;
  description: string;
  paymentStatus: string;
  customer: { fullName: string };
  statusHistory: { id: string; toStatus: string; reason: string | null; createdAt: string }[];
  riskFlags: { id: string; label: string; detail: string | null }[];
  incidents: { id: string; severity: string; status: string; summary: string }[];
  collaborators: { id: string; role: string; user: { email: string } }[];
  assignments: {
    id: string; role: string; status: string;
    agent: { fullName: string } | null; provider: { fullName: string } | null;
  }[];
  evidence: { id: string; type: string; description: string | null; uploader?: { email: string } | null }[];
  documents: { id: string; label: string; createdAt: string }[];
  reports: { id: string; summary: string; createdAt: string }[];
  quotes: { id: string; amount: string; currency: string; acceptedAt: string | null }[];
  approvals: { id: string; action: string; note: string | null; createdAt: string }[];
  recurringSchedule: { id: string; cadenceDays: number; nextRunAt: string; active: boolean } | null;
}

export default function OpsCaseDetailPage() {
  const { user, ready } = useOpsGuard();
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [needsClaim, setNeedsClaim] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);

  // Form state
  const [nextStatus, setNextStatus] = useState('');
  const [transitionReason, setTransitionReason] = useState('');
  const [quoteAmount, setQuoteAmount] = useState('');
  const [assignRole, setAssignRole] = useState<'FIELD_AGENT' | 'PROVIDER'>('FIELD_AGENT');
  const [assignTargetId, setAssignTargetId] = useState('');
  const [qcOutcome, setQcOutcome] = useState('APPROVED');
  const [qcSummary, setQcSummary] = useState('');
  const [qcNote, setQcNote] = useState('');
  const [collaboratorUserId, setCollaboratorUserId] = useState('');
  const [collaboratorRole, setCollaboratorRole] = useState('CASE_MANAGER');
  const [documentLabel, setDocumentLabel] = useState('');
  const [documentRef, setDocumentRef] = useState('');
  const [cadenceDays, setCadenceDays] = useState('30');

  function load() {
    setError(null);
    setNeedsClaim(false);
    apiFetch<CaseDetail>(`/cases/${params.id}`)
      .then(setDetail)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) {
          setNeedsClaim(true);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load case');
        }
      });
  }

  useEffect(() => {
    if (!ready) return;
    load();
    apiFetch<Agent[]>('/agents').then(setAgents).catch(() => {});
    apiFetch<Provider[]>('/providers').then(setProviders).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, params.id]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  if (!ready) return null;

  if (needsClaim) {
    return (
      <div className="card">
        <h1>Not on this case yet</h1>
        <p className="muted">
          You can see this case in the queue, but need to claim it before viewing full detail
          (case-scoped access — Non-Negotiable #6).
        </p>
        <button
          className="btn"
          disabled={busy !== null}
          onClick={() =>
            run('claim', () => apiFetch(`/cases/${params.id}/claim`, { method: 'POST' }))
          }
        >
          {busy === 'claim' ? 'Claiming…' : 'Claim this case'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  if (error && !detail) return <p className="error-text">{error}</p>;
  if (!detail) return <p className="muted">Loading…</p>;

  const isAdmin = user && ADMIN_ROLES.includes(user.role);

  return (
    <div>
      <div className="hero">
        <h1>{detail.caseNumber}</h1>
        <p>
          {detail.customer.fullName} · {humanServiceType(detail.serviceType)} · {detail.location}
        </p>
        <span className="badge">{humanCaseStatus(detail.status)}</span>{' '}
        <span className="muted">
          Priority {detail.priority} · Risk level {detail.riskLevel} · Payment {detail.paymentStatus}
        </span>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>What the customer asked for</h2>
        <p>{detail.description}</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Advance status</h2>
        <p className="muted">The backend enforces which transitions are valid — an invalid pick is rejected with an explanation.</p>
        <div className="actions-row">
          <select value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
            <option value="">Select status…</option>
            {CASE_STATUSES.map((s) => (
              <option key={s} value={s}>{humanCaseStatus(s)}</option>
            ))}
          </select>
          <input
            placeholder="Reason (optional)"
            value={transitionReason}
            onChange={(e) => setTransitionReason(e.target.value)}
            style={{ flex: 1, minWidth: '10rem' }}
          />
          <button
            className="btn"
            disabled={!nextStatus || busy !== null}
            onClick={() =>
              run('transition', () =>
                apiFetch(`/cases/${detail.id}/transition`, {
                  method: 'POST',
                  body: JSON.stringify({ toStatus: nextStatus, reason: transitionReason || undefined }),
                }),
              )
            }
          >
            {busy === 'transition' ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Quote</h2>
        {detail.quotes.map((q) => (
          <p key={q.id}>
            {q.currency} {Number(q.amount).toLocaleString()} — {q.acceptedAt ? `accepted ${new Date(q.acceptedAt).toLocaleDateString()}` : 'awaiting customer acceptance'}
          </p>
        ))}
        {detail.quotes.length === 0 && detail.status === 'UNDER_REVIEW' && (
          <div className="actions-row">
            <input
              type="number"
              placeholder="Amount (NGN)"
              value={quoteAmount}
              onChange={(e) => setQuoteAmount(e.target.value)}
            />
            <button
              className="btn"
              disabled={!quoteAmount || busy !== null}
              onClick={() =>
                run('quote', () =>
                  apiFetch(`/cases/${detail.id}/quotes`, {
                    method: 'POST',
                    body: JSON.stringify({ amount: Number(quoteAmount), currency: 'NGN' }),
                  }),
                )
              }
            >
              {busy === 'quote' ? 'Issuing…' : 'Issue quote'}
            </button>
          </div>
        )}
        {detail.quotes.length === 0 && detail.status !== 'UNDER_REVIEW' && (
          <p className="muted">A quote can only be issued while the case is under review.</p>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Assignment</h2>
        <p className="muted">A case can carry more than one assignment — e.g. a field agent for the visit and a lawyer for a title opinion.</p>
        {detail.assignments.length > 0 && (
          <ul>
            {detail.assignments.map((a) => (
              <li key={a.id}>
                {a.role === 'FIELD_AGENT' ? a.agent?.fullName : a.provider?.fullName} — {a.status.toLowerCase()}
              </li>
            ))}
          </ul>
        )}
        {['SCHEDULED', 'ASSIGNED', 'IN_PROGRESS'].includes(detail.status) ? (
          <div className="actions-row">
            <select value={assignRole} onChange={(e) => { setAssignRole(e.target.value as 'FIELD_AGENT' | 'PROVIDER'); setAssignTargetId(''); }}>
              <option value="FIELD_AGENT">Field agent</option>
              <option value="PROVIDER">Provider</option>
            </select>
            <select value={assignTargetId} onChange={(e) => setAssignTargetId(e.target.value)}>
              <option value="">Select…</option>
              {(assignRole === 'FIELD_AGENT' ? agents : providers).map((p) => (
                <option key={p.id} value={p.id}>{p.fullName}</option>
              ))}
            </select>
            <button
              className="btn"
              disabled={!assignTargetId || busy !== null}
              onClick={() =>
                run('assign', () =>
                  apiFetch(`/cases/${detail.id}/assignments`, {
                    method: 'POST',
                    body: JSON.stringify(
                      assignRole === 'FIELD_AGENT'
                        ? { role: assignRole, agentId: assignTargetId }
                        : { role: assignRole, providerId: assignTargetId },
                    ),
                  }),
                )
              }
            >
              {busy === 'assign' ? 'Assigning…' : detail.assignments.length > 0 ? 'Add another assignment' : 'Assign'}
            </button>
          </div>
        ) : (
          detail.assignments.length === 0 && (
            <p className="muted">A case can only be assigned once payment has scheduled it.</p>
          )
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Evidence</h2>
        {detail.evidence.length === 0 ? (
          <p className="muted">None submitted yet.</p>
        ) : (
          <ul>
            {detail.evidence.map((e) => (
              <li key={e.id}>
                <strong>{e.type}</strong> — {e.description ?? 'No description'}{' '}
                <span className="muted">by {e.uploader?.email ?? 'unknown'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Documents</h2>
        {detail.documents.length === 0 ? (
          <p className="muted">None on file yet.</p>
        ) : (
          <ul>
            {detail.documents.map((d) => (
              <li key={d.id}>{d.label} — <span className="muted">{new Date(d.createdAt).toLocaleDateString()}</span></li>
            ))}
          </ul>
        )}
        <div className="actions-row">
          <input placeholder="Label" value={documentLabel} onChange={(e) => setDocumentLabel(e.target.value)} />
          <input placeholder="File reference" value={documentRef} onChange={(e) => setDocumentRef(e.target.value)} />
          <button
            className="btn btn--secondary"
            disabled={!documentLabel || !documentRef || busy !== null}
            onClick={() =>
              run('document', async () => {
                await apiFetch(`/cases/${detail.id}/documents`, {
                  method: 'POST',
                  body: JSON.stringify({ label: documentLabel, storageKey: documentRef }),
                });
                setDocumentLabel('');
                setDocumentRef('');
              })
            }
          >
            {busy === 'document' ? 'Adding…' : 'Add document'}
          </button>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Quality control</h2>
        {detail.reports.map((r) => (
          <p key={r.id}>
            <strong>Report issued:</strong> {r.summary}
          </p>
        ))}
        {['EVIDENCE_SUBMITTED', 'QUALITY_CONTROL'].includes(detail.status) ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '32rem' }}>
            <select value={qcOutcome} onChange={(e) => setQcOutcome(e.target.value)}>
              <option value="APPROVED">Approve (issues report)</option>
              <option value="REWORK">Send back for rework</option>
              <option value="ESCALATE">Escalate</option>
              <option value="INCIDENT">Log incident</option>
            </select>
            {qcOutcome === 'APPROVED' && (
              <textarea
                placeholder="Report summary (required to approve)"
                value={qcSummary}
                onChange={(e) => setQcSummary(e.target.value)}
              />
            )}
            <input
              placeholder="Note (optional)"
              value={qcNote}
              onChange={(e) => setQcNote(e.target.value)}
            />
            <button
              className="btn"
              disabled={busy !== null || (qcOutcome === 'APPROVED' && !qcSummary)}
              onClick={() =>
                run('qc', () =>
                  apiFetch(`/cases/${detail.id}/qc`, {
                    method: 'POST',
                    body: JSON.stringify({ outcome: qcOutcome, summary: qcSummary || undefined, note: qcNote || undefined }),
                  }),
                )
              }
              style={{ alignSelf: 'flex-start' }}
            >
              {busy === 'qc' ? 'Submitting…' : 'Submit QC decision'}
            </button>
          </div>
        ) : (
          detail.reports.length === 0 && <p className="muted">Not ready for QC yet.</p>
        )}
      </div>

{(detail.riskFlags.length > 0 || detail.incidents.length > 0 || detail.riskLevel > 1) && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Risk flags &amp; incidents</h2>
          <ul>
            {detail.riskFlags.map((f) => (
              <li key={f.id} className="error-text">{f.label}{f.detail ? ` — ${f.detail}` : ''}</li>
            ))}
            {detail.incidents.map((i) => (
              <li key={i.id} className="error-text">[{i.severity}] {i.summary}</li>
            ))}
            {detail.riskFlags.length === 0 && detail.incidents.length === 0 && (
              <li className="muted">Nothing open — risk level {detail.riskLevel} from the last assessment.</li>
            )}
          </ul>
          <button
            className="btn btn--ghost"
            disabled={busy !== null}
            onClick={() => run('risk', () => apiFetch(`/cases/${detail.id}/risk-assessment`, { method: 'POST' }))}
          >
            {busy === 'risk' ? 'Recomputing…' : 'Recompute risk level'}
          </button>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Team on this case</h2>
        <ul>
          {detail.collaborators.map((c) => (
            <li key={c.id}>{c.user.email} — {c.role.replace(/_/g, ' ').toLowerCase()}</li>
          ))}
        </ul>
        {isAdmin && (
          <div className="actions-row">
            <input
              placeholder="User ID"
              value={collaboratorUserId}
              onChange={(e) => setCollaboratorUserId(e.target.value)}
            />
            <select value={collaboratorRole} onChange={(e) => setCollaboratorRole(e.target.value)}>
              <option value="CASE_MANAGER">Case manager</option>
              <option value="RELATIONSHIP_MANAGER">Relationship manager</option>
              <option value="QUALITY_CONTROL">Quality control</option>
              <option value="FINANCE">Finance</option>
              <option value="COMPLIANCE_RISK">Compliance/risk</option>
            </select>
            <button
              className="btn"
              disabled={!collaboratorUserId || busy !== null}
              onClick={() =>
                run('collab', () =>
                  apiFetch(`/cases/${detail.id}/collaborators`, {
                    method: 'POST',
                    body: JSON.stringify({ userId: collaboratorUserId, role: collaboratorRole }),
                  }),
                )
              }
            >
              {busy === 'collab' ? 'Adding…' : 'Add'}
            </button>
          </div>
        )}
      </div>

      {['COMPLETED', 'CLOSED'].includes(detail.status) && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Recurring service</h2>
          <p className="muted">Turn this into a recurring visit schedule (Section 6 — Construction Supervision is the model case, but any service can recur).</p>
          {detail.recurringSchedule ? (
            <>
              <p>
                Every {detail.recurringSchedule.cadenceDays} days — next visit{' '}
                {new Date(detail.recurringSchedule.nextRunAt).toLocaleDateString()} —{' '}
                <span className="badge">{detail.recurringSchedule.active ? 'active' : 'paused'}</span>
              </p>
              <button
                className="btn btn--ghost"
                disabled={busy !== null}
                onClick={() =>
                  run('recurrence', () =>
                    apiFetch(`/cases/${detail.id}/recurrence`, {
                      method: 'PATCH',
                      body: JSON.stringify({ active: !detail.recurringSchedule!.active }),
                    }),
                  )
                }
              >
                {busy === 'recurrence' ? 'Updating…' : detail.recurringSchedule.active ? 'Pause' : 'Reactivate'}
              </button>
            </>
          ) : (
            <div className="actions-row">
              <input
                type="number"
                min={7}
                max={365}
                value={cadenceDays}
                onChange={(e) => setCadenceDays(e.target.value)}
                style={{ width: '6rem' }}
              />
              <span className="muted">days between visits</span>
              <button
                className="btn"
                disabled={busy !== null}
                onClick={() =>
                  run('recurrence', () =>
                    apiFetch(`/cases/${detail.id}/recurrence`, {
                      method: 'POST',
                      body: JSON.stringify({ cadenceDays: Number(cadenceDays) }),
                    }),
                  )
                }
              >
                {busy === 'recurrence' ? 'Setting up…' : 'Set up recurring schedule'}
              </button>
            </div>
          )}
        </div>
      )}

      {detail.approvals.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Customer decisions</h2>
          <ul>
            {detail.approvals.map((a) => (
              <li key={a.id}>{a.action.replace(/_/g, ' ').toLowerCase()} — {new Date(a.createdAt).toLocaleString()}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
