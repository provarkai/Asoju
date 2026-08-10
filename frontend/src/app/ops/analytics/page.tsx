'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';
import { humanCaseStatus } from '@/lib/case-status';

interface Summary {
  customers: { total: number; withCases: number; repeatCustomers: number; repeatRate: number | null };
  cases: { total: number; byStatus: Record<string, number>; completionRate: number | null };
  financial: {
    revenueByCurrency: Record<string, number>;
    avgCaseValue: number | null;
    acceptedQuoteCount: number;
    directCostsByCurrency: Record<string, number>;
    contributionByCurrency: Record<string, number>;
    contributionMarginByCurrency: Record<string, number | null>;
  };
  trust: { avgRating: number | null; ratingCount: number };
  operations: {
    totalQcReviews: number;
    qcOutcomeCounts: Record<string, number>;
    reworkRate: number | null;
    overdueCases: number;
    unownedActiveCases: number;
    exceptionsRaised: number;
    incidentsBySeverity: Record<string, number>;
  };
  generatedAt: string;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ flex: '1 1 12rem' }}>
      <div className="muted" style={{ fontSize: '0.8rem' }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function pct(n: number | null): string {
  return n === null ? '—' : `${(n * 100).toFixed(0)}%`;
}

// Section 12 P1 "advanced analytics" — a working subset of Section 13's success metrics.
export default function OpsAnalyticsPage() {
  const { ready } = useOpsGuard();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    apiFetch<Summary>('/analytics/summary')
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load analytics'));
  }, [ready]);

  if (!ready) return null;
  if (error) return <p className="error-text">{error}</p>;
  if (!summary) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="hero">
        <h1>Analytics</h1>
        <p className="muted">Computed live from the same data everything else reads — last refreshed {new Date(summary.generatedAt).toLocaleTimeString()}.</p>
      </div>

      <h2>North Star — Successful Customer Cases</h2>
      <div className="actions-row" style={{ flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <Stat label="Total cases" value={String(summary.cases.total)} />
        <Stat label="Completion rate" value={pct(summary.cases.completionRate)} />
        <Stat label="Total customers" value={String(summary.customers.total)} />
        <Stat label="Repeat customer rate" value={pct(summary.customers.repeatRate)} />
      </div>

      <h2>Financial</h2>
      <div className="actions-row" style={{ flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        {Object.entries(summary.financial.revenueByCurrency).length === 0 ? (
          <Stat label="Revenue collected" value="₦0" />
        ) : (
          Object.entries(summary.financial.revenueByCurrency).map(([currency, amount]) => (
            <Stat key={currency} label={`Revenue (${currency})`} value={amount.toLocaleString()} />
          ))
        )}
        <Stat
          label="Avg case value"
          value={summary.financial.avgCaseValue !== null ? summary.financial.avgCaseValue.toLocaleString() : '—'}
        />
      </div>

      <h2>Contribution</h2>
      <p className="muted" style={{ marginTop: '-0.5rem' }}>
        Contribution = Revenue − direct case costs (representative, travel, third-party, other) recorded
        by Finance on each case.
      </p>
      <div className="actions-row" style={{ flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        {Object.keys(summary.financial.contributionByCurrency).length === 0 ? (
          <Stat label="Contribution" value="—" />
        ) : (
          Object.entries(summary.financial.contributionByCurrency).map(([currency, amount]) => (
            <Stat key={currency} label={`Contribution (${currency})`} value={amount.toLocaleString()} />
          ))
        )}
        {Object.entries(summary.financial.directCostsByCurrency).map(([currency, amount]) => (
          <Stat key={currency} label={`Direct costs (${currency})`} value={amount.toLocaleString()} />
        ))}
        {Object.entries(summary.financial.contributionMarginByCurrency).map(([currency, margin]) => (
          <Stat key={currency} label={`Contribution margin (${currency})`} value={pct(margin)} />
        ))}
      </div>

      <h2>Trust &amp; Quality</h2>
      <div className="actions-row" style={{ flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <Stat
          label="Average rating"
          value={summary.trust.avgRating !== null ? `${summary.trust.avgRating.toFixed(1)}★ (${summary.trust.ratingCount})` : '—'}
        />
        <Stat label="QC reviews" value={String(summary.operations.totalQcReviews)} />
        <Stat label="Rework rate" value={pct(summary.operations.reworkRate)} />
        <Stat label="Exceptions raised" value={String(summary.operations.exceptionsRaised)} />
        <Stat label="Overdue cases" value={String(summary.operations.overdueCases)} />
        <Stat label="Unowned active cases" value={String(summary.operations.unownedActiveCases)} />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Cases by status</h2>
        <ul>
          {Object.entries(summary.cases.byStatus).map(([status, count]) => (
            <li key={status}>{humanCaseStatus(status)}: {count}</li>
          ))}
        </ul>
      </div>

      {Object.keys(summary.operations.incidentsBySeverity).length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Incidents by severity</h2>
          <ul>
            {Object.entries(summary.operations.incidentsBySeverity).map(([severity, count]) => (
              <li key={severity} className="error-text">{severity}: {count}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
