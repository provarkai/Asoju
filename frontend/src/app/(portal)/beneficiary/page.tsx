'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useBeneficiaryGuard } from '@/lib/useBeneficiaryGuard';
import { humanCaseStatus, humanServiceType } from '@/lib/case-status';

interface CaseRow {
  id: string;
  caseNumber: string;
  serviceType: string;
  status: string;
  location: string;
  createdAt: string;
}

// "Who is a Beneficiary" (portal access) — a read-only list of the cases
// this person has been named on, nothing more (CasesService.listCasesForUser's
// BENEFICIARY branch already scopes the query to their own Beneficiary row).
export default function BeneficiaryCaseListPage() {
  const { ready } = useBeneficiaryGuard();
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    apiFetch<CaseRow[]>('/cases')
      .then(setCases)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load cases'));
  }, [ready]);

  if (!ready) return null;

  return (
    <div>
      <div className="hero">
        <h1>Cases you can see</h1>
        <p>You&apos;ve been named on these — status, schedule, evidence, and the final report as they come in.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        {cases === null && <p className="muted">Loading…</p>}
        {cases && cases.length === 0 && <p className="muted">No cases have named you yet.</p>}
        {cases && cases.length > 0 && (
          <div className="case-list">
            {cases.map((c) => (
              <Link key={c.id} href={`/beneficiary/cases/${c.id}`} className="case-row">
                <div className="case-row__meta">
                  <strong>{c.caseNumber}</strong>
                  <span className="muted">
                    {humanServiceType(c.serviceType)} · {c.location}
                  </span>
                </div>
                <span className="badge">{humanCaseStatus(c.status)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
