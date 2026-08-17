'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useFieldGuard } from '@/lib/useFieldGuard';
import { useFieldAgentId } from '@/lib/useFieldAgentId';
import { formatNaira } from '@/lib/currency';

interface WalletEntry {
  id: string;
  type: string;
  amount: string;
  caseId: string | null;
  description: string | null;
  createdAt: string;
}

interface Wallet {
  availableBalance: string;
  totalEarnings: string;
  totalPaid: string;
  entries: WalletEntry[];
}

interface MonthlyEarnings {
  month: string;
  totalNaira: number;
  earningCount: number;
}

interface EarningsProjection {
  basis: 'no_history' | 'trailing_average';
  monthsOfHistory: number;
  trailingAverageMonthlyNaira: number;
  projectedNextMonthNaira: number;
  projectedNextQuarterNaira: number;
  projectedNextYearNaira: number;
}

interface SavingsPlan {
  recommendedRatePercent: number;
  recommendedMonthlySavingsNaira: number;
  projected6MonthNaira: number;
  projected12MonthNaira: number;
}

interface TaxEstimate {
  grossAnnualIncomeNaira: number;
  taxableIncomeNaira: number;
  totalEstimatedTaxNaira: number;
  effectiveRatePercent: number;
  disclaimer: string;
}

interface FinancialPlan {
  history: MonthlyEarnings[];
  projection: EarningsProjection;
  savingsPlan: SavingsPlan;
  taxEstimate: TaxEstimate;
}

interface LedgerLine {
  id: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: string;
  account: { code: string; name: string };
}

interface LedgerEntry {
  id: string;
  entityType: string;
  description: string | null;
  createdAt: string;
  lines: LedgerLine[];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ flex: '1 1 12rem' }}>
      <div className="muted" style={{ fontSize: '0.8rem' }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

// #54 — the field portal had no view at all for the wallet, financial
// planning, or ledger endpoints (#38/#39/#52), even though every one of
// them already worked and already had FIELD_AGENT self-access built in on
// the backend. This is that missing surface, not a new backend capability.
export default function FieldEarningsPage() {
  const { ready: guardReady } = useFieldGuard();
  const { agentId, ready: agentReady } = useFieldAgentId();

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [plan, setPlan] = useState<FinancialPlan | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLedger, setShowLedger] = useState(false);

  useEffect(() => {
    if (!agentReady || !agentId) return;
    Promise.all([
      apiFetch<Wallet>(`/agents/${agentId}/wallet`),
      apiFetch<FinancialPlan>(`/agents/${agentId}/financial-plan`),
      apiFetch<LedgerEntry[]>(`/agents/${agentId}/ledger`),
    ])
      .then(([w, p, l]) => {
        setWallet(w);
        setPlan(p);
        setLedger(l);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load earnings'));
  }, [agentReady, agentId]);

  if (!guardReady || !agentReady) return null;

  if (!agentId) {
    return (
      <div className="card">
        <p className="muted">Earnings tracking applies to field agent accounts — not available for provider accounts.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="hero">
        <h1>Earnings &amp; wallet</h1>
        <p>What you&apos;ve earned, what&apos;s been paid out, and what to expect ahead.</p>
      </div>

      {error && <p className="error-text">{error}</p>}
      {!wallet && !error && <p className="muted">Loading…</p>}

      {wallet && (
        <>
          <div className="actions-row" style={{ flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            <Stat label="Available balance" value={formatNaira(wallet.availableBalance)} />
            <Stat label="Total earned" value={formatNaira(wallet.totalEarnings)} />
            <Stat label="Total paid out" value={formatNaira(wallet.totalPaid)} />
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Recent activity</h2>
            {wallet.entries.length === 0 && <p className="muted">Nothing recorded yet.</p>}
            {wallet.entries.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--asoju-border)' }}>
                    <th style={{ padding: '0.4rem' }}>When</th>
                    <th style={{ padding: '0.4rem' }}>Type</th>
                    <th style={{ padding: '0.4rem' }}>Amount</th>
                    <th style={{ padding: '0.4rem' }}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {wallet.entries.map((e) => (
                    <tr key={e.id} style={{ borderBottom: '1px solid var(--asoju-border)' }}>
                      <td style={{ padding: '0.4rem' }}>{new Date(e.createdAt).toLocaleDateString()}</td>
                      <td style={{ padding: '0.4rem' }}>{e.type === 'EARNING' ? 'Earning' : 'Payout'}</td>
                      <td style={{ padding: '0.4rem' }}>
                        {e.type === 'EARNING' ? '+' : '−'}
                        {formatNaira(e.amount)}
                      </td>
                      <td style={{ padding: '0.4rem' }} className="muted">{e.description ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {plan && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Looking ahead</h2>
          {plan.projection.basis === 'no_history' ? (
            <p className="muted">Not enough earnings history yet to project — check back after your first payout.</p>
          ) : (
            <>
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                Based on your trailing {plan.projection.monthsOfHistory}-month average of {formatNaira(plan.projection.trailingAverageMonthlyNaira)}/month.
              </p>
              <div className="actions-row" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
                <Stat label="Next month" value={formatNaira(plan.projection.projectedNextMonthNaira)} />
                <Stat label="Next quarter" value={formatNaira(plan.projection.projectedNextQuarterNaira)} />
                <Stat label="Next year" value={formatNaira(plan.projection.projectedNextYearNaira)} />
              </div>
              <p>
                Saving <strong>{plan.savingsPlan.recommendedRatePercent}%</strong> ({formatNaira(plan.savingsPlan.recommendedMonthlySavingsNaira)}/month) would put you at{' '}
                <strong>{formatNaira(plan.savingsPlan.projected12MonthNaira)}</strong> in 12 months.
              </p>
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                Estimated tax at this income level: {formatNaira(plan.taxEstimate.totalEstimatedTaxNaira)}/year ({plan.taxEstimate.effectiveRatePercent.toFixed(1)}% effective rate).{' '}
                {plan.taxEstimate.disclaimer}
              </p>
            </>
          )}
        </div>
      )}

      {ledger && ledger.length > 0 && (
        <div className="card">
          <button className="btn btn--ghost" onClick={() => setShowLedger((s) => !s)}>
            {showLedger ? 'Hide' : 'Show'} accounting detail
          </button>
          {showLedger && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.75rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--asoju-border)' }}>
                  <th style={{ padding: '0.4rem' }}>When</th>
                  <th style={{ padding: '0.4rem' }}>Account</th>
                  <th style={{ padding: '0.4rem' }}>Direction</th>
                  <th style={{ padding: '0.4rem' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {ledger.flatMap((entry) =>
                  entry.lines.map((line) => (
                    <tr key={line.id} style={{ borderBottom: '1px solid var(--asoju-border)' }}>
                      <td style={{ padding: '0.4rem' }}>{new Date(entry.createdAt).toLocaleDateString()}</td>
                      <td style={{ padding: '0.4rem' }}>{line.account.name}</td>
                      <td style={{ padding: '0.4rem' }} className="muted">{line.direction}</td>
                      <td style={{ padding: '0.4rem' }}>{formatNaira(line.amount)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
