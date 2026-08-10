'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { useOpsGuard } from '@/lib/useOpsGuard';
import { ADMIN_ROLES, FINANCE_ROLES } from '@/lib/roles';
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
  owner: { id: string; email: string; role: string } | null;
  nextAction: string | null;
  nextActionDueAt: string | null;
  slaTargetAt: string | null;
  statusHistory: { id: string; toStatus: string; reason: string | null; createdAt: string }[];
  riskFlags: { id: string; label: string; detail: string | null }[];
  incidents: { id: string; severity: string; status: string; summary: string }[];
  collaborators: { id: string; role: string; user: { email: string } }[];
  assignments: {
    id: string; role: string; status: string;
    agent: { fullName: string } | null; provider: { fullName: string } | null;
  }[];
  evidence: { id: string; type: string; description: string | null; uploader?: { email: string } | null; viewUrl: string }[];
  documents: { id: string; label: string; createdAt: string; visibility: string; restrictedToAssignmentId: string | null; viewUrl: string }[];
  reports: { id: string; summary: string; limitation: string | null; createdAt: string }[];
  quotes: {
    id: string;
    amount: string;
    currency: string;
    acceptedAt: string | null;
    expiresAt: string | null;
    baseAmount: string | null;
    nonServiceFeeAmount: string | null;
    discountPercent: string | null;
    discountAmount: string | null;
    scAppliedNgn: string | null;
    lines: { id: string; category: string; label: string; amount: string }[];
  }[];
  invoices: {
    id: string;
    amount: string;
    currency: string;
    payments: { id: string; status: string; amount: string; currency: string; providerReference: string }[];
  }[];
  approvals: { id: string; action: string; note: string | null; createdAt: string }[];
  recurringSchedule: { id: string; cadenceDays: number; nextRunAt: string; active: boolean } | null;
}

interface ScopeDetail {
  id: string;
  version: number;
  objective: string;
  tasks: string[];
  deliverables: string[];
  exclusions: string[];
  evidenceRequirements: string[];
  confirmedAt: string | null;
  createdAt: string;
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
  interface QuoteLineDraft { category: string; label: string; amount: string }
  const [quoteLines, setQuoteLines] = useState<QuoteLineDraft[]>([
    { category: 'ASOJU_SERVICE_FEE', label: 'ASOJU service fee', amount: '' },
  ]);
  const [refundAmount, setRefundAmount] = useState<Record<string, string>>({});
  const [refundReason, setRefundReason] = useState<Record<string, string>>({});
  const [reconcileNotes, setReconcileNotes] = useState<Record<string, string>>({});
  const [reconcileAmount, setReconcileAmount] = useState<Record<string, string>>({});
  const [ownerUserId, setOwnerUserId] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [nextActionDueAt, setNextActionDueAt] = useState('');
  const [assignRole, setAssignRole] = useState<'FIELD_AGENT' | 'PROVIDER'>('FIELD_AGENT');
  const [assignTargetId, setAssignTargetId] = useState('');
  const [qcOutcome, setQcOutcome] = useState('APPROVED');
  const [qcSummary, setQcSummary] = useState('');
  const [qcNote, setQcNote] = useState('');
  const [collaboratorUserId, setCollaboratorUserId] = useState('');
  const [collaboratorRole, setCollaboratorRole] = useState('CASE_MANAGER');
  const [documentLabel, setDocumentLabel] = useState('');
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentVisibility, setDocumentVisibility] = useState('ALL');
  const [scope, setScope] = useState<ScopeDetail | null>(null);
  const [scopeObjective, setScopeObjective] = useState('');
  const [scopeTasks, setScopeTasks] = useState('');
  const [scopeDeliverables, setScopeDeliverables] = useState('');
  const [scopeExclusions, setScopeExclusions] = useState('');
  const [scopeEvidence, setScopeEvidence] = useState('');
  const [scopeFormOpen, setScopeFormOpen] = useState(false);
  const [documentAssignmentId, setDocumentAssignmentId] = useState('');
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
    apiFetch<ScopeDetail | null>(`/cases/${params.id}/scope`).then(setScope).catch(() => {});
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
        {!['COMPLETED', 'CLOSED'].includes(detail.status) &&
          detail.slaTargetAt &&
          new Date(detail.slaTargetAt).getTime() < Date.now() && (
            <span className="badge badge--error">Overdue</span>
          )}{' '}
        <span className="muted">
          Priority {detail.priority} · Risk level {detail.riskLevel} · Payment {detail.paymentStatus}
        </span>
        <br />
        <span className="muted">
          Owner: {detail.owner?.email ?? '— unassigned —'}
          {detail.nextAction && <> · Next action: {detail.nextAction}</>}
          {detail.nextActionDueAt && <> (due {new Date(detail.nextActionDueAt).toLocaleString()})</>}
          {detail.slaTargetAt && <> · SLA target: {new Date(detail.slaTargetAt).toLocaleString()}</>}
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
        <h2 style={{ marginTop: 0 }}>Scope</h2>
        <p className="muted">
          What&apos;s actually agreed before there&apos;s a price — the customer must confirm this version before
          a quote can be issued. Proposing a new version replaces this one and needs re-confirmation.
        </p>
        {scope ? (
          <div style={{ marginBottom: '1rem' }}>
            <p>
              <strong>v{scope.version}</strong> —{' '}
              {scope.confirmedAt ? (
                <span className="badge">Confirmed {new Date(scope.confirmedAt).toLocaleDateString()}</span>
              ) : (
                <span className="badge" style={{ borderColor: 'var(--asoju-gold, orange)' }}>Awaiting customer confirmation</span>
              )}
            </p>
            <p><strong>Objective:</strong> {scope.objective}</p>
            <p><strong>Tasks:</strong> {scope.tasks.join('; ')}</p>
            {scope.deliverables.length > 0 && <p><strong>Deliverables:</strong> {scope.deliverables.join('; ')}</p>}
            {scope.exclusions.length > 0 && <p><strong>Exclusions:</strong> {scope.exclusions.join('; ')}</p>}
            {scope.evidenceRequirements.length > 0 && (
              <p><strong>Evidence required:</strong> {scope.evidenceRequirements.join('; ')}</p>
            )}
          </div>
        ) : (
          <p className="muted">No scope proposed yet.</p>
        )}
        {detail.status === 'UNDER_REVIEW' && !scopeFormOpen && (
          <button className="btn btn--ghost" onClick={() => setScopeFormOpen(true)}>
            {scope ? 'Propose a revised scope' : 'Propose scope'}
          </button>
        )}
        {detail.status === 'UNDER_REVIEW' && scopeFormOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '32rem' }}>
            <input placeholder="Objective" value={scopeObjective} onChange={(e) => setScopeObjective(e.target.value)} />
            <textarea
              placeholder="Tasks — one per line"
              value={scopeTasks}
              onChange={(e) => setScopeTasks(e.target.value)}
              rows={3}
            />
            <textarea
              placeholder="Deliverables — one per line (optional)"
              value={scopeDeliverables}
              onChange={(e) => setScopeDeliverables(e.target.value)}
              rows={2}
            />
            <textarea
              placeholder="Exclusions — one per line (optional)"
              value={scopeExclusions}
              onChange={(e) => setScopeExclusions(e.target.value)}
              rows={2}
            />
            <textarea
              placeholder="Evidence required — one per line (optional)"
              value={scopeEvidence}
              onChange={(e) => setScopeEvidence(e.target.value)}
              rows={2}
            />
            <div className="actions-row">
              <button
                className="btn"
                disabled={!scopeObjective || !scopeTasks || busy !== null}
                onClick={() =>
                  run('scope', async () => {
                    await apiFetch(`/cases/${detail.id}/scope`, {
                      method: 'POST',
                      body: JSON.stringify({
                        objective: scopeObjective,
                        tasks: scopeTasks.split('\n').map((s) => s.trim()).filter(Boolean),
                        deliverables: scopeDeliverables.split('\n').map((s) => s.trim()).filter(Boolean),
                        exclusions: scopeExclusions.split('\n').map((s) => s.trim()).filter(Boolean),
                        evidenceRequirements: scopeEvidence.split('\n').map((s) => s.trim()).filter(Boolean),
                      }),
                    });
                    setScopeObjective('');
                    setScopeTasks('');
                    setScopeDeliverables('');
                    setScopeExclusions('');
                    setScopeEvidence('');
                    setScopeFormOpen(false);
                  })
                }
              >
                {busy === 'scope' ? 'Sending…' : 'Send to customer for confirmation'}
              </button>
              <button className="btn btn--ghost" onClick={() => setScopeFormOpen(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Quote</h2>
        {detail.quotes.map((q) => (
          <div key={q.id} style={{ marginBottom: '0.75rem' }}>
            {q.lines.map((line) => (
              <div key={line.id} className="case-row">
                <span className="muted">
                  {line.label}
                  {line.category !== 'ASOJU_SERVICE_FEE' && (
                    <span className="badge" style={{ marginLeft: '0.4rem', fontSize: '0.7rem' }}>
                      {line.category.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  )}
                </span>
                <span>{q.currency} {Number(line.amount).toLocaleString()}</span>
              </div>
            ))}
            {q.discountPercent && (
              <div className="case-row">
                <span className="muted">Membership discount ({Number(q.discountPercent)}%)</span>
                <span>−{q.currency} {Number(q.discountAmount).toLocaleString()}</span>
              </div>
            )}
            {q.scAppliedNgn && Number(q.scAppliedNgn) > 0 && (
              <div className="case-row">
                <span className="muted">SC applied</span>
                <span>−{q.currency} {Number(q.scAppliedNgn).toLocaleString()}</span>
              </div>
            )}
            <div className="case-row">
              <strong>Total</strong>
              <strong>{q.currency} {Number(q.amount).toLocaleString()}</strong>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              {q.acceptedAt
                ? `Accepted ${new Date(q.acceptedAt).toLocaleDateString()}`
                : q.expiresAt && new Date(q.expiresAt) < new Date()
                  ? 'Expired unaccepted'
                  : 'Awaiting customer acceptance'}
            </p>
            {!q.acceptedAt && q.expiresAt && (
              <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                Valid until {new Date(q.expiresAt).toLocaleString()}
              </p>
            )}
          </div>
        ))}
        {detail.status === 'UNDER_REVIEW' && detail.quotes.some((q) => q.expiresAt && !q.acceptedAt && new Date(q.expiresAt) < new Date()) && (
          <p className="muted">The previous quote above expired unaccepted — issue a new one below.</p>
        )}
        {detail.quotes.length === 0 && detail.status === 'UNDER_REVIEW' && !scope?.confirmedAt && (
          <p className="muted">
            {scope ? 'The customer needs to confirm the scope above before a quote can be issued.' : 'Propose a scope above and have the customer confirm it before issuing a quote.'}
          </p>
        )}
        {detail.status === 'UNDER_REVIEW' && scope?.confirmedAt && (
          <div>
            {quoteLines.map((line, i) => (
              <div key={i} className="actions-row" style={{ marginBottom: '0.4rem' }}>
                <select
                  value={line.category}
                  onChange={(e) => setQuoteLines((ls) => ls.map((l, j) => (j === i ? { ...l, category: e.target.value } : l)))}
                >
                  <option value="ASOJU_SERVICE_FEE">ASOJU service fee</option>
                  <option value="EXTERNAL_COST">External cost</option>
                  <option value="THIRD_PARTY_PROFESSIONAL">Third-party professional fee</option>
                  <option value="TAX_STATUTORY">Tax / statutory</option>
                </select>
                <input
                  placeholder="Label"
                  value={line.label}
                  onChange={(e) => setQuoteLines((ls) => ls.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)))}
                />
                <input
                  type="number"
                  placeholder="Amount (NGN)"
                  value={line.amount}
                  onChange={(e) => setQuoteLines((ls) => ls.map((l, j) => (j === i ? { ...l, amount: e.target.value } : l)))}
                />
                {quoteLines.length > 1 && (
                  <button className="btn btn--ghost" onClick={() => setQuoteLines((ls) => ls.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                )}
              </div>
            ))}
            <div className="actions-row">
              <button
                className="btn btn--secondary"
                onClick={() => setQuoteLines((ls) => [...ls, { category: 'EXTERNAL_COST', label: '', amount: '' }])}
              >
                Add line
              </button>
              <button
                className="btn"
                disabled={busy !== null || quoteLines.some((l) => !l.label || !l.amount)}
                onClick={() =>
                  run('quote', () =>
                    apiFetch(`/cases/${detail.id}/quotes`, {
                      method: 'POST',
                      body: JSON.stringify({
                        currency: 'NGN',
                        lines: quoteLines.map((l) => ({ category: l.category, label: l.label, amount: Number(l.amount) })),
                      }),
                    }),
                  )
                }
              >
                {busy === 'quote' ? 'Issuing…' : 'Issue quote'}
              </button>
            </div>
          </div>
        )}
        {detail.quotes.length === 0 && detail.status !== 'UNDER_REVIEW' && (
          <p className="muted">A quote can only be issued while the case is under review.</p>
        )}
      </div>

      {user && FINANCE_ROLES.includes(user.role) && detail.invoices.some((inv) => inv.payments.length > 0) && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Payments</h2>
          {detail.invoices.flatMap((inv) => inv.payments).map((p) => {
            const refundable = p.status === 'PAID' || p.status === 'PARTIALLY_REFUNDED';
            return (
              <div key={p.id} className="case-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}>
                <div className="actions-row" style={{ justifyContent: 'space-between' }}>
                  <span>{p.currency} {Number(p.amount).toLocaleString()} · {p.providerReference}</span>
                  <span className={p.status === 'PAID' ? 'badge' : p.status === 'RECONCILIATION_REQUIRED' ? 'error-text' : 'muted'}>
                    {p.status.replace(/_/g, ' ').toLowerCase()}
                  </span>
                </div>
                {refundable && (
                  <div className="actions-row">
                    <input
                      type="number"
                      placeholder="Amount (blank = full remaining)"
                      value={refundAmount[p.id] ?? ''}
                      onChange={(e) => setRefundAmount((r) => ({ ...r, [p.id]: e.target.value }))}
                      style={{ maxWidth: '12rem' }}
                    />
                    <input
                      placeholder="Reason (required)"
                      value={refundReason[p.id] ?? ''}
                      onChange={(e) => setRefundReason((r) => ({ ...r, [p.id]: e.target.value }))}
                    />
                    <button
                      className="btn btn--secondary"
                      disabled={busy !== null || !refundReason[p.id]}
                      onClick={() =>
                        run(`refund-${p.id}`, () =>
                          apiFetch(`/admin/payments/${p.id}/refund`, {
                            method: 'POST',
                            body: JSON.stringify({
                              amount: refundAmount[p.id] ? Number(refundAmount[p.id]) : undefined,
                              reason: refundReason[p.id],
                            }),
                          }),
                        )
                      }
                    >
                      {busy === `refund-${p.id}` ? 'Refunding…' : 'Issue refund'}
                    </button>
                  </div>
                )}
                {p.status === 'RECONCILIATION_REQUIRED' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <p className="muted" style={{ margin: 0 }}>
                      Paystack&apos;s webhook amount didn&apos;t match this invoice — check the Audit Log
                      (action <code>payment.reconciliation_required</code>) for the expected/received amounts,
                      then resolve it below.
                    </p>
                    <div className="actions-row">
                      <input
                        type="number"
                        placeholder="Corrected amount (optional, MATCHED only)"
                        value={reconcileAmount[p.id] ?? ''}
                        onChange={(e) => setReconcileAmount((r) => ({ ...r, [p.id]: e.target.value }))}
                        style={{ maxWidth: '16rem' }}
                      />
                      <input
                        placeholder="Notes (required)"
                        value={reconcileNotes[p.id] ?? ''}
                        onChange={(e) => setReconcileNotes((r) => ({ ...r, [p.id]: e.target.value }))}
                      />
                    </div>
                    <div className="actions-row">
                      <button
                        className="btn btn--secondary"
                        disabled={busy !== null || !reconcileNotes[p.id]}
                        onClick={() =>
                          run(`reconcile-${p.id}`, () =>
                            apiFetch(`/admin/payments/${p.id}/reconcile`, {
                              method: 'POST',
                              body: JSON.stringify({
                                status: 'MATCHED',
                                notes: reconcileNotes[p.id],
                                resolvedAmount: reconcileAmount[p.id] ? Number(reconcileAmount[p.id]) : undefined,
                              }),
                            }),
                          )
                        }
                      >
                        {busy === `reconcile-${p.id}` ? 'Resolving…' : 'Matched — mark paid'}
                      </button>
                      <button
                        className="btn btn--ghost"
                        disabled={busy !== null || !reconcileNotes[p.id]}
                        onClick={() =>
                          run(`reconcile-${p.id}`, () =>
                            apiFetch(`/admin/payments/${p.id}/reconcile`, {
                              method: 'POST',
                              body: JSON.stringify({ status: 'REJECTED', notes: reconcileNotes[p.id] }),
                            }),
                          )
                        }
                      >
                        {busy === `reconcile-${p.id}` ? 'Resolving…' : 'Rejected — let customer retry'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

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
                <span className="muted">by {e.uploader?.email ?? 'unknown'}</span>{' '}
                <a href={e.viewUrl} target="_blank" rel="noreferrer">view</a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Documents</h2>
        <p className="muted">
          A field actor only sees a document if it&apos;s unrestricted or specifically shared with their
          own assignment — restricting one doesn&apos;t affect what the customer or staff can see.
        </p>
        {detail.documents.length === 0 ? (
          <p className="muted">None on file yet.</p>
        ) : (
          <ul>
            {detail.documents.map((d) => {
              const restrictedTo = detail.assignments.find((a) => a.id === d.restrictedToAssignmentId);
              return (
                <li key={d.id}>
                  <a href={d.viewUrl} target="_blank" rel="noreferrer">{d.label}</a> —{' '}
                  <span className="muted">{new Date(d.createdAt).toLocaleDateString()}</span>{' '}
                  {d.visibility === 'STAFF_ONLY' && <span className="badge">Staff only</span>}
                  {d.visibility === 'ASSIGNEE' && (
                    <span className="badge">
                      Only {restrictedTo?.agent?.fullName ?? restrictedTo?.provider?.fullName ?? 'one assignee'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="actions-row" style={{ flexWrap: 'wrap' }}>
          <input placeholder="Label" value={documentLabel} onChange={(e) => setDocumentLabel(e.target.value)} />
          <input type="file" onChange={(e) => setDocumentFile(e.target.files?.[0] ?? null)} />
          <select value={documentVisibility} onChange={(e) => setDocumentVisibility(e.target.value)}>
            <option value="ALL">Visible to every assignee</option>
            <option value="STAFF_ONLY">Staff only (no field actor)</option>
            <option value="ASSIGNEE">Only one assignee…</option>
          </select>
          {documentVisibility === 'ASSIGNEE' && (
            <select value={documentAssignmentId} onChange={(e) => setDocumentAssignmentId(e.target.value)}>
              <option value="">Select assignment…</option>
              {detail.assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.agent?.fullName ?? a.provider?.fullName ?? a.role} ({a.role})
                </option>
              ))}
            </select>
          )}
          <button
            className="btn btn--secondary"
            disabled={
              !documentLabel ||
              !documentFile ||
              busy !== null ||
              (documentVisibility === 'ASSIGNEE' && !documentAssignmentId)
            }
            onClick={() =>
              run('document', async () => {
                const storageKey = await uploadFile('documents', detail.id, documentFile as File);
                await apiFetch(`/cases/${detail.id}/documents`, {
                  method: 'POST',
                  body: JSON.stringify({
                    label: documentLabel,
                    storageKey,
                    visibility: documentVisibility,
                    restrictedToAssignmentId: documentVisibility === 'ASSIGNEE' ? documentAssignmentId : undefined,
                  }),
                });
                setDocumentLabel('');
                setDocumentFile(null);
                setDocumentVisibility('ALL');
                setDocumentAssignmentId('');
              })
            }
          >
            {busy === 'document' ? 'Uploading…' : 'Add document'}
          </button>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Quality control</h2>
        {detail.reports.map((r) => (
          <p key={r.id}>
            <strong>Report issued:</strong> {r.summary}
            {r.limitation && <span className="muted"> — limitation: {r.limitation}</span>}
          </p>
        ))}
        {['EVIDENCE_SUBMITTED', 'QUALITY_CONTROL'].includes(detail.status) ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '32rem' }}>
            <select value={qcOutcome} onChange={(e) => setQcOutcome(e.target.value)}>
              <option value="APPROVED">Approve (issues report)</option>
              <option value="PASS_WITH_LIMITATION">Approve with a noted limitation (issues report)</option>
              <option value="REWORK">Send back for rework</option>
              <option value="REVISIT_REQUIRED">Require a site revisit</option>
              <option value="ESCALATE">Escalate</option>
              <option value="INCIDENT">Log incident</option>
            </select>
            {(qcOutcome === 'APPROVED' || qcOutcome === 'PASS_WITH_LIMITATION') && (
              <textarea
                placeholder="Report summary (required to approve)"
                value={qcSummary}
                onChange={(e) => setQcSummary(e.target.value)}
              />
            )}
            <input
              placeholder={
                qcOutcome === 'PASS_WITH_LIMITATION'
                  ? 'Limitation to record on the report (required)'
                  : qcOutcome === 'REVISIT_REQUIRED'
                    ? 'What the revisit needs to cover (required)'
                    : 'Note (optional)'
              }
              value={qcNote}
              onChange={(e) => setQcNote(e.target.value)}
            />
            <button
              className="btn"
              disabled={
                busy !== null ||
                ((qcOutcome === 'APPROVED' || qcOutcome === 'PASS_WITH_LIMITATION') && !qcSummary) ||
                ((qcOutcome === 'PASS_WITH_LIMITATION' || qcOutcome === 'REVISIT_REQUIRED') && !qcNote)
              }
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
        <h2 style={{ marginTop: 0 }}>Ownership &amp; next action</h2>
        <p className="muted">
          Every active case should answer who owns it and what happens next — same discipline as the
          claim workflow, but for a single accountable owner and the concrete next step.
        </p>
        <p>
          Owner: <strong>{detail.owner?.email ?? '— unassigned —'}</strong>
        </p>
        <div className="actions-row">
          <input
            placeholder="Owner user ID"
            value={ownerUserId}
            onChange={(e) => setOwnerUserId(e.target.value)}
          />
          <button
            className="btn btn--secondary"
            disabled={!ownerUserId || busy !== null}
            onClick={() =>
              run('owner', () =>
                apiFetch(`/cases/${detail.id}/assign-owner`, {
                  method: 'POST',
                  body: JSON.stringify({ ownerUserId }),
                }),
              )
            }
          >
            {busy === 'owner' ? 'Assigning…' : 'Assign owner'}
          </button>
        </div>
        <p style={{ marginTop: '1rem' }}>
          Next action: <strong>{detail.nextAction ?? '— none set —'}</strong>
          {detail.nextActionDueAt && ` (due ${new Date(detail.nextActionDueAt).toLocaleString()})`}
        </p>
        <div className="actions-row">
          <input
            placeholder="What happens next"
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
            style={{ flex: 1 }}
          />
          <input
            type="datetime-local"
            value={nextActionDueAt}
            onChange={(e) => setNextActionDueAt(e.target.value)}
          />
          <button
            className="btn btn--secondary"
            disabled={!nextAction || busy !== null}
            onClick={() =>
              run('next-action', () =>
                apiFetch(`/cases/${detail.id}/next-action`, {
                  method: 'POST',
                  body: JSON.stringify({
                    nextAction,
                    dueAt: nextActionDueAt ? new Date(nextActionDueAt).toISOString() : undefined,
                  }),
                }),
              )
            }
          >
            {busy === 'next-action' ? 'Saving…' : 'Set next action'}
          </button>
        </div>
      </div>

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
