'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';
import { humanCaseStatus, humanServiceType } from '@/lib/case-status';

interface RiskAssessment {
  score: number;
  level: number;
  factors: Record<string, unknown>;
  assessedAt: string;
}
interface FlaggedCase {
  id: string;
  caseNumber: string;
  serviceType: string;
  status: string;
  riskLevel: number;
  customer: { fullName: string };
  riskAssessments: RiskAssessment[];
}

const FACTOR_LABELS: Record<string, string> = {
  openRiskFlags: 'Open risk flags',
  incidentPointsThisCase: 'Incident severity (this case)',
  priorIncidentsOtherCases: 'Prior incidents (other cases)',
  lowPerformingAssignee: 'Low-performing assignee',
  urgentPriority: 'Urgent priority',
  reworkCycles: 'QC rework cycles',
  highValue: 'High case value',
};

// Section 12 P2 "advanced risk engine" — every case the deterministic
// scorer (RiskEngineService) has flagged level 3+ (high/critical), most
// recently assessed first. Org-wide, like the case queue (Section 5.3).
export default function OpsRiskPage() {
  const { ready } = useOpsGuard();
  const [cases, setCases] = useState<FlaggedCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    apiFetch<FlaggedCase[]>('/risk/flagged-cases').then(setCases).catch((e) => setError(e.message));
  }, [ready]);

  if (!ready) return null;

  return (
    <div>
      <div className="hero">
        <h1>Risk queue</h1>
        <p>Cases scored high or critical by the deterministic risk engine — never an AI judgment call.</p>
      </div>

      {error && <p className="error-text">{error}</p>}
      {cases === null && !error && <p className="muted">Loading…</p>}
      {cases && cases.length === 0 && <p className="muted">No high-risk cases right now.</p>}

      {cases && cases.map((c) => {
        const latest = c.riskAssessments[0];
        return (
          <div key={c.id} className="card">
            <div className="actions-row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>
                <Link href={`/ops/cases/${c.id}`}>{c.caseNumber}</Link>{' '}
                <span className="muted" style={{ fontWeight: 400 }}>
                  {c.customer.fullName} · {humanServiceType(c.serviceType)}
                </span>
              </h2>
              <div className="actions-row">
                <span className="badge">{humanCaseStatus(c.status)}</span>
                <span className="error-text">Risk level {c.riskLevel}{latest ? ` (score ${latest.score})` : ''}</span>
              </div>
            </div>
            {latest && (
              <ul className="muted" style={{ marginBottom: 0 }}>
                {Object.entries(latest.factors)
                  .filter(([, value]) => value && value !== 0)
                  .map(([key, value]) => (
                    <li key={key}>
                      {FACTOR_LABELS[key] ?? key}: {typeof value === 'boolean' ? 'yes' : String(value)}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
