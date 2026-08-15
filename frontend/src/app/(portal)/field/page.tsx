'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useFieldGuard } from '@/lib/useFieldGuard';
import { humanCaseStatus, humanServiceType } from '@/lib/case-status';

interface OwnAssignment {
  id: string;
  status: string;
  scheduledFor: string | null;
  checkInAt: string | null;
}

interface JobRow {
  id: string;
  caseNumber: string;
  serviceType: string;
  status: string;
  location: string;
  priority: string;
  assignments: OwnAssignment[];
}

// Section 5.4 — Field Agent App: "Job list (today's assignments)".
export default function FieldJobListPage() {
  const { user, ready } = useFieldGuard();
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    apiFetch<JobRow[]>('/cases')
      .then(setJobs)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load jobs'));
  }, [ready]);

  if (!ready) return null;

  const active = (jobs ?? []).filter((j) => j.assignments[0]?.status !== 'COMPLETED');
  const done = (jobs ?? []).filter((j) => j.assignments[0]?.status === 'COMPLETED');

  return (
    <div>
      <div className="hero">
        <h1>Your jobs</h1>
        <p>Everything you&apos;ve been assigned — accept, check in, and work through the checklist for each.</p>
        {user?.role === 'PROVIDER' && (
          <p>
            <Link href="/field/credentials">Manage your credentials →</Link>
          </p>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        {jobs === null && <p className="muted">Loading…</p>}
        {jobs && active.length === 0 && <p className="muted">Nothing assigned to you right now.</p>}
        {active.length > 0 && (
          <div className="case-list">
            {active.map((j) => {
              const a = j.assignments[0];
              return (
                <Link key={j.id} href={`/field/cases/${j.id}`} className="case-row">
                  <div className="case-row__meta">
                    <strong>{j.caseNumber}</strong>
                    <span className="muted">
                      {humanServiceType(j.serviceType)} · {j.location}
                    </span>
                    {a?.checkInAt && <span className="muted">Checked in {new Date(a.checkInAt).toLocaleString()}</span>}
                  </div>
                  <span className="badge">{a ? a.status.toLowerCase() : humanCaseStatus(j.status)}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {done.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Completed</h2>
          <div className="case-list">
            {done.map((j) => (
              <Link key={j.id} href={`/field/cases/${j.id}`} className="case-row">
                <div className="case-row__meta">
                  <strong>{j.caseNumber}</strong>
                  <span className="muted">{humanServiceType(j.serviceType)}</span>
                </div>
                <span className="badge">{humanCaseStatus(j.status)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
