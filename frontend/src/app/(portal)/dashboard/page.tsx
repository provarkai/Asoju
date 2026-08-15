'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { humanCaseStatus, humanServiceType } from '@/lib/case-status';
import { AssistantChat } from '@/components/AssistantChat';

interface CaseSummary {
  id: string;
  caseNumber: string;
  serviceType: string;
  status: string;
  priority: string;
  location: string;
  createdAt: string;
}

interface ServiceRequestSummary {
  id: string;
  rawDescription: string;
  convertedCaseId: string | null;
  createdAt: string;
}

interface LastCase {
  id: string;
  caseNumber: string;
  status: string;
  createdAt: string;
}

interface PropertyPortfolio {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  lastCase: LastCase | null;
}

interface AssetPortfolio {
  id: string;
  assetType: string;
  description: string | null;
  location: string | null;
  lastCase: LastCase | null;
}

interface BeneficiaryPortfolio {
  id: string;
  fullName: string;
  relationship: string | null;
  hasPortalAccess: boolean;
}

interface UpcomingVisit {
  caseId: string;
  caseNumber: string;
  serviceType: string;
  role: string;
  scheduledFor: string;
}

interface Portfolio {
  totalCases: number;
  completedCases: number;
  activeCasesByStatus: Record<string, number>;
  totalSpendByCurrency: Record<string, number>;
  properties: PropertyPortfolio[];
  assets: AssetPortfolio[];
  beneficiaries: BeneficiaryPortfolio[];
  upcomingVisits: UpcomingVisit[];
  membership: { plan: string; status: string; scBalanceUsd: number } | null;
  referral: { code: string; referredCount: number };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ flex: '1 1 12rem' }}>
      <div className="muted" style={{ fontSize: '0.8rem' }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function formatMoney(amountsByCurrency: Record<string, number>): string {
  const entries = Object.entries(amountsByCurrency);
  if (entries.length === 0) return '—';
  return entries.map(([currency, amount]) => `${currency} ${amount.toLocaleString()}`).join(' · ');
}

// Section 5.1 — Case dashboard, reworked around the portfolio summary
// (strategic-suggestions pass): one screen instead of piecing the same
// picture together from cases/properties/assets/subscription separately.
export default function DashboardPage() {
  const { ready } = useAuthGuard();
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [requests, setRequests] = useState<ServiceRequestSummary[] | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    Promise.all([
      apiFetch<CaseSummary[]>('/cases'),
      apiFetch<ServiceRequestSummary[]>('/service-requests'),
      apiFetch<Portfolio>('/me/portfolio'),
    ])
      .then(([c, r, p]) => {
        setCases(c);
        setRequests(r.filter((req) => !req.convertedCaseId));
        setPortfolio(p);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load your cases'));
  }, [ready]);

  if (!ready) return null;

  const activeCaseCount = portfolio
    ? Object.values(portfolio.activeCasesByStatus).reduce((sum, n) => sum + n, 0)
    : 0;

  return (
    <div>
      <div className="hero">
        <h1>Your cases</h1>
        <p>Everything you&apos;ve asked ASOJU to handle in Nigeria, in one place.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      {portfolio && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
          <Stat label="Active cases" value={String(activeCaseCount)} />
          <Stat label="Completed cases" value={String(portfolio.completedCases)} />
          <Stat label="Total spend" value={formatMoney(portfolio.totalSpendByCurrency)} />
          <Stat
            label="Membership"
            value={portfolio.membership ? `${portfolio.membership.plan} · $${portfolio.membership.scBalanceUsd.toFixed(2)} SC` : 'None'}
          />
        </div>
      )}

      {portfolio && portfolio.upcomingVisits.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Upcoming visits</h2>
          <div className="case-list">
            {portfolio.upcomingVisits.map((v) => (
              <Link key={`${v.caseId}-${v.scheduledFor}`} href={`/cases/${v.caseId}`} className="case-row">
                <div className="case-row__meta">
                  <strong>{v.caseNumber}</strong>
                  <span className="muted">{humanServiceType(v.serviceType)}</span>
                </div>
                <span className="badge">{new Date(v.scheduledFor).toLocaleString()}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {requests && requests.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Pending review</h2>
          <p className="muted">
            These requests are with our team and haven&apos;t become a case yet — no action needed
            from you right now.
          </p>
          <div className="case-list">
            {requests.map((r) => (
              <div key={r.id} className="case-row">
                <div className="case-row__meta">
                  <strong>{r.rawDescription}</strong>
                  <span className="muted">Submitted {new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
                <span className="badge">Under review</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Active &amp; past cases</h2>
        {cases === null && <p className="muted">Loading…</p>}
        {cases && cases.length === 0 && (
          <p className="muted">
            No cases yet. Use the concierge on the home page to tell us what you need handled.
          </p>
        )}
        {cases && cases.length > 0 && (
          <div className="case-list">
            {cases.map((c) => (
              <Link key={c.id} href={`/cases/${c.id}`} className="case-row">
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

      {portfolio && (portfolio.properties.length > 0 || portfolio.assets.length > 0) && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Properties &amp; assets</h2>
          <p className="muted">Manage the full list from your profile — here&apos;s where each one last stood.</p>
          <div className="case-list">
            {portfolio.properties.map((p) => (
              <div key={p.id} className="case-row">
                <div className="case-row__meta">
                  <strong>{p.address}{p.city ? `, ${p.city}` : ''}</strong>
                  {p.lastCase ? (
                    <span className="muted">Last case {p.lastCase.caseNumber} — {humanCaseStatus(p.lastCase.status)}</span>
                  ) : (
                    <span className="muted">No case yet</span>
                  )}
                </div>
                {p.lastCase && (
                  <Link href={`/cases/${p.lastCase.id}`} className="badge">
                    View
                  </Link>
                )}
              </div>
            ))}
            {portfolio.assets.map((a) => (
              <div key={a.id} className="case-row">
                <div className="case-row__meta">
                  <strong>{a.assetType}{a.location ? ` — ${a.location}` : ''}</strong>
                  {a.lastCase ? (
                    <span className="muted">Last case {a.lastCase.caseNumber} — {humanCaseStatus(a.lastCase.status)}</span>
                  ) : (
                    <span className="muted">No case yet</span>
                  )}
                </div>
                {a.lastCase && (
                  <Link href={`/cases/${a.lastCase.id}`} className="badge">
                    View
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {portfolio && portfolio.beneficiaries.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Beneficiaries</h2>
          <p className="muted">
            Manage these — and invite one to their own read-only login — from{' '}
            <Link href="/profile">your profile</Link>.
          </p>
          <div className="case-list">
            {portfolio.beneficiaries.map((b) => (
              <div key={b.id} className="case-row">
                <span>{b.fullName}{b.relationship ? ` (${b.relationship})` : ''}</span>
                <span className="badge">{b.hasPortalAccess ? 'Has portal access' : 'No portal access'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {portfolio && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Referrals</h2>
          <p className="muted">
            You&apos;ve referred {portfolio.referral.referredCount} customer{portfolio.referral.referredCount === 1 ? '' : 's'}.
            Share your code — full link on <Link href="/profile">your profile</Link>.
          </p>
          <p><strong>{portfolio.referral.code}</strong></p>
        </div>
      )}

      <AssistantChat />
    </div>
  );
}
