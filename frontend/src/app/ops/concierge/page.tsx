'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';
import { FINANCE_ROLES } from '@/lib/roles';

interface Rm { id: string; email: string | null }
interface CustomerRow {
  id: string;
  fullName: string;
  user: { email: string | null };
  assignedRm: Rm | null;
  subscriptions: { id: string; status: string; tier: string; plan: string }[];
}
interface PlanConfig {
  plan: 'PRIORITY' | 'PREMIUM';
  priceUsd: number;
  scGrantUsd: number;
  discountPercent: number;
  eligibleRequestsPerMonth: number;
  updatedAt: string;
}

/** P0 UX Spec "Admin Screen — Pricing Configuration" — edits write to
 * MembershipPlanConfig (see backend PlanConfigService); already-active
 * subscriptions keep their locked-in priceUsd/fxRate, so a price change
 * here only affects new subscribers, while discount/SC/allowance changes
 * apply live to everyone's next quote or renewal. */
function PlanPricingCard() {
  const [configs, setConfigs] = useState<PlanConfig[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { priceUsd: string; scGrantUsd: string; discountPercent: string; eligibleRequestsPerMonth: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  function load() {
    apiFetch<PlanConfig[]>('/membership-plans')
      .then((rows) => {
        setConfigs(rows);
        setDrafts(
          Object.fromEntries(
            rows.map((r) => [
              r.plan,
              {
                priceUsd: String(r.priceUsd),
                scGrantUsd: String(r.scGrantUsd),
                discountPercent: String(r.discountPercent),
                eligibleRequestsPerMonth: String(r.eligibleRequestsPerMonth),
              },
            ]),
          ),
        );
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
  }, []);

  async function save(plan: string) {
    const draft = drafts[plan];
    if (!draft) return;
    setSaving(plan);
    setError(null);
    try {
      await apiFetch(`/admin/membership-plans/${plan}`, {
        method: 'PATCH',
        body: JSON.stringify({
          priceUsd: Number(draft.priceUsd),
          scGrantUsd: Number(draft.scGrantUsd),
          discountPercent: Number(draft.discountPercent),
          eligibleRequestsPerMonth: Number(draft.eligibleRequestsPerMonth),
        }),
      });
      setSavedAt(plan);
      setTimeout(() => setSavedAt(null), 2000);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save pricing');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Membership pricing</h2>
      <p className="muted">
        Editing here takes effect immediately for discount%, SC grant, and eligible requests/mo on every
        member&apos;s next quote or renewal. Price changes only apply to new subscribers — existing
        subscriptions keep the price they locked in when they subscribed.
      </p>
      {error && <p className="error-text">{error}</p>}
      {configs === null && <p className="muted">Loading…</p>}
      {configs && (
        <div className="actions-row" style={{ flexWrap: 'wrap' }}>
          {configs.map((c) => {
            const draft = drafts[c.plan];
            if (!draft) return null;
            return (
              <div key={c.plan} className="card" style={{ flex: '1 1 16rem' }}>
                <strong>{c.plan === 'PREMIUM' ? 'Premium' : 'Priority'}</strong>
                <label>
                  Price (USD/mo)
                  <input
                    type="number"
                    min={0}
                    value={draft.priceUsd}
                    onChange={(e) => setDrafts((d) => ({ ...d, [c.plan]: { ...d[c.plan], priceUsd: e.target.value } }))}
                  />
                </label>
                <label>
                  SC grant (USD)
                  <input
                    type="number"
                    min={0}
                    value={draft.scGrantUsd}
                    onChange={(e) => setDrafts((d) => ({ ...d, [c.plan]: { ...d[c.plan], scGrantUsd: e.target.value } }))}
                  />
                </label>
                <label>
                  Discount (%)
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.discountPercent}
                    onChange={(e) => setDrafts((d) => ({ ...d, [c.plan]: { ...d[c.plan], discountPercent: e.target.value } }))}
                  />
                </label>
                <label>
                  Eligible requests/mo
                  <input
                    type="number"
                    min={0}
                    value={draft.eligibleRequestsPerMonth}
                    onChange={(e) => setDrafts((d) => ({ ...d, [c.plan]: { ...d[c.plan], eligibleRequestsPerMonth: e.target.value } }))}
                  />
                </label>
                <button className="btn" disabled={saving === c.plan} onClick={() => save(c.plan)}>
                  {saving === c.plan ? 'Saving…' : savedAt === c.plan ? 'Saved ✓' : 'Save'}
                </button>
                <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                  Last updated {new Date(c.updatedAt).toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Section 12 P1 "Concierge workflow" — admin assigns a Relationship
// Manager to each Concierge-subscribed customer's portfolio.
export default function OpsConciergePage() {
  const { ready, user } = useOpsGuard();
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [rms, setRms] = useState<Rm[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<CustomerRow[]>('/concierge/customers').then(setCustomers).catch((e) => setError(e.message));
    apiFetch<Rm[]>('/concierge/relationship-managers').then(setRms).catch(() => {});
  }

  useEffect(() => {
    if (ready) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function assign(customerId: string, rmUserId: string) {
    if (!rmUserId) return;
    try {
      await apiFetch(`/concierge/customers/${customerId}/rm`, {
        method: 'PATCH',
        body: JSON.stringify({ rmUserId }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign RM');
    }
  }

  if (!ready) return null;

  return (
    <div>
      <div className="hero">
        <h1>Concierge</h1>
        <p>Every customer, their subscription status, and who owns their relationship.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      {user && FINANCE_ROLES.includes(user.role) && <PlanPricingCard />}

      {rms.length === 0 && (
        <p className="muted">No Relationship Manager accounts exist yet — provision one via Prisma/psql to assign portfolios.</p>
      )}

      <div className="card">
        {customers === null && <p className="muted">Loading…</p>}
        {customers && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--asoju-border)' }}>
                <th style={{ padding: '0.4rem' }}>Customer</th>
                <th style={{ padding: '0.4rem' }}>Subscription</th>
                <th style={{ padding: '0.4rem' }}>Relationship Manager</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const sub = c.subscriptions[0];
                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--asoju-border)' }}>
                    <td style={{ padding: '0.4rem' }}>
                      <Link href={`/ops/customers/${c.id}`}>{c.fullName}</Link> <span className="muted">({c.user.email})</span>
                    </td>
                    <td style={{ padding: '0.4rem' }}>
                      {sub ? (
                        <>
                          <span className="badge">{sub.plan} · {sub.status.toLowerCase()}</span>{' '}
                          <Link href={`/ops/concierge/${sub.id}`} className="muted">SC ledger</Link>
                        </>
                      ) : (
                        <span className="muted">Essential</span>
                      )}
                    </td>
                    <td style={{ padding: '0.4rem' }}>
                      <select
                        value={c.assignedRm?.id ?? ''}
                        onChange={(e) => assign(c.id, e.target.value)}
                        disabled={rms.length === 0}
                      >
                        <option value="">Unassigned</option>
                        {rms.map((rm) => (
                          <option key={rm.id} value={rm.id}>{rm.email}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
