'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useBeneficiaryGuard } from '@/lib/useBeneficiaryGuard';
import { humanCaseStatus, humanServiceType } from '@/lib/case-status';

interface StatusHistoryEntry {
  toStatus: string;
  createdAt: string;
}

interface AssignmentEntry {
  role: string;
  status: string;
  scheduledFor: string | null;
  assignee: string | null;
}

interface EvidenceEntry {
  id: string;
  type: string;
  description: string | null;
  createdAt: string;
  viewUrl: string;
}

interface DocumentEntry {
  id: string;
  label: string;
  createdAt: string;
  viewUrl: string;
}

interface ReportEntry {
  id: string;
  summary: string;
  limitation: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

// "Who is a Beneficiary" (portal access) — the shape here mirrors exactly
// what beneficiary-case-view.ts's BENEFICIARY_CASE_SELECT projects: no
// quotes, invoices, approvals, collaborators, risk flags, incidents, or
// owner/customer fields ever come back from this endpoint for this role.
interface BeneficiaryCaseDetail {
  id: string;
  caseNumber: string;
  serviceType: string;
  status: string;
  location: string;
  description: string;
  createdAt: string;
  statusHistory: StatusHistoryEntry[];
  assignments: AssignmentEntry[];
  evidence: EvidenceEntry[];
  documents: DocumentEntry[];
  reports: ReportEntry[];
}

export default function BeneficiaryCaseDetailPage() {
  const { ready } = useBeneficiaryGuard();
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<BeneficiaryCaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    apiFetch<BeneficiaryCaseDetail>(`/cases/${params.id}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load case'));
  }, [ready, params.id]);

  if (!ready) return null;
  if (error) return <p className="error-text">{error}</p>;
  if (!detail) return <p className="muted">Loading…</p>;

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
        <h2 style={{ marginTop: 0 }}>What this case covers</h2>
        <p>{detail.description}</p>
      </div>

      {detail.assignments.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Who&apos;s on it</h2>
          <ul>
            {detail.assignments.map((a, i) => (
              <li key={i}>
                {a.assignee ?? 'Unassigned'} — <span className="muted">{a.role.replace(/_/g, ' ').toLowerCase()}</span>
                {a.scheduledFor && (
                  <span className="muted"> · scheduled {new Date(a.scheduledFor).toLocaleString()}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Timeline</h2>
        <ul className="timeline">
          {detail.statusHistory.map((h, i) => (
            <li key={i}>
              <strong>{humanCaseStatus(h.toStatus)}</strong>
              <div className="muted">{new Date(h.createdAt).toLocaleString()}</div>
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
                <a href={e.viewUrl} target="_blank" rel="noreferrer">
                  View
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {detail.documents.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Documents</h2>
          <ul>
            {detail.documents.map((d) => (
              <li key={d.id}>
                {d.label}{' '}
                <a href={d.viewUrl} target="_blank" rel="noreferrer">
                  View
                </a>{' '}
                <span className="muted">{new Date(d.createdAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Report</h2>
        {detail.reports.length === 0 ? (
          <p className="muted">The report will appear here once quality control is complete.</p>
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
    </div>
  );
}
