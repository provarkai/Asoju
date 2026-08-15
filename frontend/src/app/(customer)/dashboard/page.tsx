'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CaseCard, CaseSummary } from '@/components/portal/CaseCard';
import { EmptyState, StatCard, StatusPill } from '@/components/portal/ui';
import { BellRing, CheckCircle2, CircleDollarSign, FilePlus2, FolderOpen, MessageSquare, Sparkles } from 'lucide-react';
import { apiFetch, getSessionUser } from '@/lib/api';
import { timeAgo } from '@/lib/statusMeta';
import { cn } from '@/lib/utils';

interface Portfolio {
  fullName: string;
  completedCases: number;
  totalSpendByCurrency: Record<string, number>;
}

interface ServiceRequestSummary {
  id: string;
  rawDescription: string;
  convertedCaseId: string | null;
  createdAt: string;
}

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

const ACTION_REQUIRED_STATUSES = new Set(['QUOTED', 'AWAITING_PAYMENT', 'CUSTOMER_REVIEW']);
const INACTIVE_STATUSES = new Set(['COMPLETED', 'CLOSED', 'APPROVED']);

function formatSpend(byCurrency: Record<string, number>): string {
  const entries = Object.entries(byCurrency);
  if (entries.length === 0) return '—';
  return entries.map(([currency, amount]) => `${currency} ${amount.toLocaleString()}`).join(' · ');
}

// Section 5.1 — customer home. Ported from asoju-app-main's HomeView,
// rebuilt on three real endpoints (/cases, /me/portfolio, /notifications)
// instead of the single Convex getDashboard query it used.
export default function DashboardHome() {
  const router = useRouter();
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ServiceRequestSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<CaseSummary[]>('/cases'),
      apiFetch<Portfolio>('/me/portfolio'),
      apiFetch<NotificationItem[]>('/notifications'),
      apiFetch<ServiceRequestSummary[]>('/service-requests'),
    ])
      .then(([c, p, n, r]) => {
        setCases(c);
        setPortfolio(p);
        setNotifications(n);
        setPendingRequests(r.filter((req) => !req.convertedCaseId));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load your dashboard'));
  }, []);

  if (error) return <p className="error-text">{error}</p>;
  if (!cases || !portfolio) {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-forest/5" />
        ))}
      </div>
    );
  }

  const firstName = portfolio.fullName?.split(' ')[0] ?? getSessionUser()?.email?.split('@')[0] ?? 'friend';
  const active = cases.filter((k) => !INACTIVE_STATUSES.has(k.status));
  const needsAction = cases.filter((k) => ACTION_REQUIRED_STATUSES.has(k.status));
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-forest p-7 text-ivory shadow-xl shadow-forest/20 sm:p-9">
        <div className="absolute inset-0 pattern-grid-dark" />
        <div className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-gold/20 blur-3xl" />
        <div className="relative">
          <p className="flex items-center gap-2 text-sm text-gold-light">
            <Sparkles className="size-4" />
            Welcome back, {firstName}
          </p>
          <h1 className="mt-2 max-w-lg font-display text-3xl font-semibold leading-tight sm:text-4xl">
            What would you like us to handle for you in Nigeria?
          </h1>
          <p className="mt-3 max-w-xl text-sm text-ivory/70">
            Tell us in plain words — a property, a build, an asset, a family errand. We&apos;ll take it from request
            to evidence-backed report.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              className="h-11 bg-gold px-6 font-semibold text-forest-deep shadow-lg shadow-gold/20 transition-transform hover:-translate-y-0.5 hover:bg-gold-light"
              onClick={() => router.push('/dashboard/new')}
            >
              <FilePlus2 className="size-4" />
              Start a request
            </Button>
            <Button
              variant="outline"
              className="h-11 border-ivory/25 bg-transparent px-6 text-ivory hover:bg-ivory/10"
              onClick={() => router.push('/profile')}
            >
              <MessageSquare className="size-4" />
              Set preferences
            </Button>
          </div>
        </div>
      </section>

      {/* Needs action */}
      {needsAction.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <BellRing className="size-4.5 text-clay" />
            <h2 className="font-display text-lg font-semibold text-forest">Needs your action</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {needsAction.map((k) => (
              <button
                key={k.id}
                onClick={() => router.push(`/dashboard/cases/${k.id}`)}
                className="group flex items-center justify-between gap-3 rounded-2xl border border-gold/40 bg-gold/5 px-4 py-3.5 text-left transition-all hover:-translate-y-0.5 hover:bg-gold/10 hover:shadow-md"
              >
                <div className="min-w-0">
                  <p className="font-mono text-[11px] font-semibold text-forest/50">{k.caseNumber}</p>
                  <p className="truncate text-sm font-semibold text-forest">{k.description}</p>
                  <p className="mt-0.5 text-[11px] text-clay">{k.nextAction ?? 'Action required'}</p>
                </div>
                <StatusPill status={k.status} className="shrink-0" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Pending review — submitted but not yet triaged into a case
          (ServiceRequest with convertedCaseId still null). Not part of
          the prototype's own HomeView (its Convex schema doesn't
          separate request-vs-case the way this backend deliberately
          does — see dashboard/new/page.tsx), restored from what the
          pre-conversion dashboard already showed here. */}
      {pendingRequests.length > 0 && (
        <section className="rounded-2xl border border-forest/10 bg-white p-5 shadow-sm">
          <h2 className="font-display text-lg font-semibold text-forest">Pending review</h2>
          <p className="mt-1 text-sm text-forest/60">
            These requests are with our team and haven&apos;t become a case yet — no action needed from you right
            now.
          </p>
          <div className="mt-3 space-y-2.5">
            {pendingRequests.map((r) => (
              <div key={r.id} className="rounded-xl border border-forest/8 bg-ivory/50 p-3.5">
                <p className="line-clamp-2 whitespace-pre-line text-sm text-forest/80">{r.rawDescription}</p>
                <p className="mt-1.5 text-[11px] text-forest/45">Submitted {new Date(r.createdAt).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Stats */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={FolderOpen} label="Active cases" value={active.length} hint="In motion right now" />
        <StatCard
          icon={CheckCircle2}
          label="Completed"
          value={portfolio.completedCases ?? 0}
          hint="Delivered with reports"
          accent="bg-emerald-100 text-emerald-700"
        />
        <StatCard
          icon={CircleDollarSign}
          label="Total spend"
          value={formatSpend(portfolio.totalSpendByCurrency)}
          hint="Confirmed payments only"
          accent="bg-gold/15 text-clay"
        />
        <StatCard icon={BellRing} label="Unread updates" value={unread} hint="Quotes, reports & more" accent="bg-sky-100 text-sky-700" />
      </section>

      {/* Latest activity */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-forest">Your cases</h2>
        </div>
        {cases.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="No cases yet"
            copy="When you start a request, it becomes a tracked case with a timeline, evidence and reports — all in one place."
            action={
              <Button className="bg-forest text-ivory hover:bg-forest-deep" onClick={() => router.push('/dashboard/new')}>
                <FilePlus2 className="size-4" />
                Start your first request
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {cases.slice(0, 6).map((k) => (
              <CaseCard key={k.id} kase={k} />
            ))}
          </div>
        )}
      </section>

      {/* Notifications strip */}
      {notifications.length > 0 && (
        <section className="rounded-2xl border border-forest/10 bg-white p-5 shadow-sm">
          <h2 className="font-display text-lg font-semibold text-forest">Recent updates</h2>
          <div className="mt-3 space-y-2.5">
            {notifications.slice(0, 4).map((n) => (
              <div key={n.id} className={cn('flex w-full items-start gap-3 rounded-xl border border-forest/8 bg-ivory/50 p-3 text-left')}>
                <Badge className="mt-0.5 border-gold/40 bg-gold/10 text-clay">
                  <Sparkles className="size-3" />
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-forest">{n.title}</p>
                  <p className="line-clamp-1 text-xs text-forest/60">{n.body}</p>
                </div>
                <span className="shrink-0 text-[10px] text-forest/40">{timeAgo(n.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
