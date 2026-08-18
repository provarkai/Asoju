'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowRight, CheckCircle2, CreditCard, Loader2, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { naira } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/portal/ui';

interface PlanConfig {
  plan: 'ESSENTIAL' | 'PRIORITY' | 'PREMIUM';
  priceUsd: number;
  scGrantUsd: number;
  discountPercent: number;
  eligibleRequestsPerMonth: number;
}

interface Subscription {
  id: string;
  plan: 'ESSENTIAL' | 'PRIORITY' | 'PREMIUM';
  status: string;
  renewsAt: string | null;
  scBalanceUsd: number;
  planConfig: PlanConfig;
}

const PLAN_LABEL: Record<string, string> = { ESSENTIAL: 'Essential', PRIORITY: 'Priority', PREMIUM: 'Premium' };
const FX_RATE_NGN_PER_USD = 1600;

// Ported from asoju-app-main's BillingView, all four tiers (Pay As You
// Go, Essential, Priority, Premium) — Essential was briefly dropped
// earlier in this conversion because the real MembershipPlan enum only
// had PRIORITY/PREMIUM at the time, but visual confirmation against the
// live asoju.freebuff.app deployment (which shows all four, and whose
// own prototype schema always had ESSENTIAL as a real subscriptionPlan
// value) made clear that was a gap in this backend, not a real design
// decision — restored by adding ESSENTIAL to the enum + seeding its
// pricing (see the migration comment) rather than leaving it out.
export default function BillingPage() {
  const [plans, setPlans] = useState<PlanConfig[] | null>(null);
  const [sub, setSub] = useState<Subscription | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    Promise.all([apiFetch<PlanConfig[]>('/membership-plans'), apiFetch<Subscription | null>('/me/subscription')])
      .then(([p, s]) => {
        setPlans(p);
        setSub(s);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load billing'));
  };

  useEffect(load, []);

  if (error && !plans) return <ErrorState message={error} onRetry={load} />;
  if (!plans || sub === undefined) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-48 animate-pulse rounded-2xl bg-forest/5" />
        ))}
      </div>
    );
  }

  // "The subscriptions are not connected to Paystack" fix — subscribing
  // no longer activates anything by itself. The backend creates a PENDING
  // subscription and returns a real Paystack checkout link; only a
  // verified payment (webhook) activates it and grants SC. Same
  // dryRun/redirect pattern as dashboard/cases/[id]/page.tsx's payNow().
  const doSubscribe = async (plan: 'ESSENTIAL' | 'PRIORITY' | 'PREMIUM') => {
    setBusy(plan);
    setError(null);
    try {
      const res = await apiFetch<{ authorizationUrl: string; dryRun: boolean }>('/me/subscription', {
        method: 'POST',
        body: JSON.stringify({ plan }),
      });
      if (res.dryRun) {
        setError('Payments aren’t configured in this environment yet (dry-run mode) — no charge was made. A real deployment would redirect to Paystack checkout now.');
        setBusy(null);
        load();
      } else {
        window.location.href = res.authorizationUrl;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(null);
    }
  };

  const doCancel = async () => {
    setBusy('cancel');
    setError(null);
    try {
      await apiFetch('/me/subscription/cancel', { method: 'POST' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const daysLeft = sub?.renewsAt ? Math.max(0, Math.ceil((new Date(sub.renewsAt).getTime() - Date.now()) / 86_400_000)) : null;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-clay">
            <CreditCard className="size-4" />
            Subscription &amp; billing
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-forest">Pick your plan — every subscription includes a monthly Service Credit</h1>
          <p className="mt-1.5 text-sm text-forest/60">Your SC voucher covers part of a case each cycle, and you pay the remainder out-of-pocket (with your tier discount).</p>
        </div>
        {sub && sub.status === 'ACTIVE' && (
          <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800">
            Active · {PLAN_LABEL[sub.plan]}
            {daysLeft !== null ? ` · ${daysLeft}d left in cycle` : ''}
          </Badge>
        )}
        {sub && sub.status === 'PENDING' && (
          <Badge className="border-gold/40 bg-gold/10 text-clay">Payment pending · {PLAN_LABEL[sub.plan]}</Badge>
        )}
      </div>

      {sub && sub.status === 'PENDING' && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gold/40 bg-gold/5 p-6">
          <div>
            <p className="font-display text-lg font-semibold text-forest">Your {PLAN_LABEL[sub.plan]} subscription is awaiting payment</p>
            <p className="mt-1 text-sm text-forest/65">Nothing is active yet — complete checkout to unlock your Service Credit and plan benefits.</p>
          </div>
          <div className="flex gap-2.5">
            <Button variant="ghost" className="text-forest/60 hover:text-forest" disabled={busy === 'cancel'} onClick={doCancel}>
              {busy === 'cancel' ? <Loader2 className="size-4 animate-spin" /> : null}
              Cancel
            </Button>
            <Button className="bg-gold font-semibold text-forest-deep hover:bg-gold-light" disabled={busy !== null} onClick={() => doSubscribe(sub.plan)}>
              {busy === sub.plan ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              Complete payment
            </Button>
          </div>
        </div>
      )}

      {sub && sub.status === 'ACTIVE' && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-gold/40 bg-gradient-to-br from-gold/10 to-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 font-display text-lg font-semibold text-forest">
                <Sparkles className="size-5 text-gold" />
                Service Credit balance
              </p>
              <p className="mt-1 text-sm text-forest/65">
                ${sub.scBalanceUsd} available · ≈ {naira(Math.round(sub.scBalanceUsd * FX_RATE_NGN_PER_USD))} at the reference rate
                {sub.renewsAt ? ` · renews ${new Date(sub.renewsAt).toLocaleDateString('en-GB')}` : ''}
              </p>
            </div>
            <div className="rounded-xl border border-forest/10 bg-white px-4 py-3 text-center">
              <p className="text-[11px] uppercase tracking-wide text-forest/45">Status</p>
              <p className={cn('mt-0.5 flex items-center gap-1.5 text-sm font-bold', sub.scBalanceUsd <= 0 ? 'text-clay' : 'text-emerald-700')}>
                {sub.scBalanceUsd <= 0 ? (
                  <>
                    <XCircle className="size-4" /> Used this cycle
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-4" /> Available
                  </>
                )}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-forest/50">
            Single-use per billing cycle. If a case costs less than the SC, the remainder is forfeited; if it costs more, you pay the difference. SC doesn&apos;t
            apply outside Lagos &amp; the South-West.
          </p>
        </div>
      )}

      {error && <p className="error-text mt-4">{error}</p>}

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col rounded-2xl border border-forest/10 bg-white p-6 shadow-sm">
          <h3 className="font-display text-lg font-semibold text-forest">Pay As You Go</h3>
          <p className="mt-1 text-xs text-forest/55">Pay-per-service, no subscription needed.</p>
          <p className="mt-4 font-display text-3xl font-semibold text-forest">
            Free
          </p>
          <ul className="mt-5 flex-1 space-y-2.5 text-sm text-forest/70">
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" />
              No monthly credits
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" />
              AI Concierge intake &amp; case tracking
            </li>
          </ul>
          <div className="mt-6 rounded-xl border border-forest/10 bg-ivory/60 py-2.5 text-center text-sm font-medium text-forest/55">Always available</div>
        </div>

        {plans.map((p) => {
          const isCurrent = sub?.status === 'ACTIVE' && sub.plan === p.plan;
          const isCurrentPending = sub?.status === 'PENDING' && sub.plan === p.plan;
          return (
            <div key={p.plan} className={cn('flex flex-col rounded-2xl border bg-white p-6 shadow-sm transition-all', p.plan === 'PRIORITY' ? 'border-gold/50 shadow-lg shadow-gold/10' : 'border-forest/10')}>
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold text-forest">{PLAN_LABEL[p.plan]}</h3>
                {p.plan === 'PRIORITY' && <Badge className="border-gold/40 bg-gold/10 text-clay">Best value</Badge>}
              </div>
              <p className="mt-4 font-display text-3xl font-semibold text-forest">
                ${p.priceUsd}
                <span className="text-sm font-medium text-forest/45"> /mo</span>
              </p>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm text-forest/70">
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" />${p.scGrantUsd} Service Credit / month
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" />
                  {p.discountPercent}% off out-of-pocket cases
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" />
                  {p.eligibleRequestsPerMonth} eligible request{p.eligibleRequestsPerMonth === 1 ? '' : 's'}/month
                </li>
              </ul>
              {isCurrent ? (
                <div className="mt-6">
                  <p className="rounded-xl bg-emerald-50 py-2.5 text-center text-sm font-semibold text-emerald-700">Current plan</p>
                  <Button variant="ghost" className="mt-2 w-full text-forest/60 hover:text-forest" disabled={busy === 'cancel'} onClick={doCancel}>
                    {busy === 'cancel' ? <Loader2 className="size-4 animate-spin" /> : null}
                    Cancel subscription
                  </Button>
                </div>
              ) : isCurrentPending ? (
                <div className="mt-6">
                  <Button className="w-full bg-gold font-semibold text-forest-deep hover:bg-gold-light" disabled={busy !== null} onClick={() => doSubscribe(p.plan)}>
                    {busy === p.plan ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                    Complete payment
                  </Button>
                  <Button variant="ghost" className="mt-2 w-full text-forest/60 hover:text-forest" disabled={busy === 'cancel'} onClick={doCancel}>
                    {busy === 'cancel' ? <Loader2 className="size-4 animate-spin" /> : null}
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  className={cn('mt-6 w-full', p.plan === 'PRIORITY' ? 'bg-gold font-semibold text-forest-deep hover:bg-gold-light' : 'bg-forest text-ivory hover:bg-forest-deep')}
                  disabled={busy !== null}
                  onClick={() => doSubscribe(p.plan)}
                >
                  {busy === p.plan ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                  {sub ? 'Switch to ' : 'Subscribe to '}
                  {PLAN_LABEL[p.plan]}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-2xl border border-forest/10 bg-white p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-forest">
          <ShieldCheck className="size-4 text-forest" />
          Commercial terms
        </p>
        <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-forest/60">
          <li>· SC is a single-use voucher per billing cycle — unused balance never rolls over.</li>
          <li>· SC cannot be applied to cases scoped to &quot;Other locations&quot; (margin protection).</li>
          <li>· Service fees are quoted in ₦; the parallel-market rate is pinned at quote time and locked for 48 hours.</li>
        </ul>
      </div>
    </div>
  );
}
