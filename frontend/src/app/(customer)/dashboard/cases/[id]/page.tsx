'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EvidenceGrid, HistoryEvent, MessageItem, MessageThread, QuoteCard, QuoteData, ReportCard, ReportData, Timeline } from '@/components/portal/CaseDetailParts';
import { ErrorState, StatusPill } from '@/components/portal/ui';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Clock,
  FileCheck2,
  Loader2,
  MapPin,
  Receipt,
  RotateCcw,
  Scale,
  ShieldCheck,
  UserRound,
  Wallet,
} from 'lucide-react';
import { apiFetch, getSessionUser } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/statusMeta';
import { naira } from '@/lib/format';
import { cn } from '@/lib/utils';

const DISPUTE_REASONS = [
  "Evidence missing or unclear",
  "Facts in the report are incorrect",
  "Photos don't match what I know",
  'Unresolved issues were not flagged',
  'Something else',
];

const PLAN_LABEL: Record<string, string> = { PAY_AS_YOU_GO: 'Pay As You Go', ESSENTIAL: 'Essential', PRIORITY: 'Priority', PREMIUM: 'Premium', CONCIERGE: 'Concierge' };

const NOT_OVERDUE_ELIGIBLE = new Set(['COMPLETED', 'CLOSED', 'APPROVED', 'ON_HOLD']);

interface CaseTaskItem {
  id: string;
  label: string;
  isComplete: boolean;
}

interface AssignmentItem {
  role: string;
  status: string;
  scheduledFor: string | null;
  agent: { userId: string; fullName: string } | null;
  provider: { userId: string; fullName: string } | null;
}

interface InvoiceItem {
  id: string;
  amount: number;
  createdAt: string;
  payments: { id: string; provider: string; providerReference: string; status: string }[];
}

interface ArrivalArrangement {
  id: string;
  type: 'AIRPORT_TRANSPORT' | 'ACCOMMODATION';
  status: string;
  detail: string | null;
}

const ARRANGEMENT_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Requested',
  BEING_SOURCED: 'Being sourced',
  AWAITING_CONFIRMATION: 'Awaiting confirmation',
  CONFIRMED: 'Confirmed',
  CHANGED: 'Changed — awaiting reconfirmation',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};
const ARRANGEMENT_CONFIRMED_STATUSES = new Set(['CONFIRMED', 'COMPLETED']);

interface CaseDetail {
  id: string;
  caseNumber: string;
  serviceType: string;
  description: string;
  location: string;
  status: string;
  priority: string;
  tier: string;
  paymentStatus: string;
  nextAction: string | null;
  nextActionDueAt: string | null;
  slaTargetAt: string | null;
  createdAt: string;
  tasks: CaseTaskItem[];
  statusHistory: HistoryEvent[];
  assignments: AssignmentItem[];
  evidence: Parameters<typeof EvidenceGrid>[0]['evidence'];
  quotes: QuoteData[];
  invoices: InvoiceItem[];
  reports: ReportData[];
}

// Ported from asoju-app-main's CaseDetailView. Several deliberate
// departures from the original, all because the real backend's
// architecture differs from the prototype's Convex schema — see the
// comments at each divergence below.
export default function CaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const caseId = params.id as string;
  const currentUserId = getSessionUser()?.id;

  const [kase, setKase] = useState<CaseDetail | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [arrangements, setArrangements] = useState<ArrivalArrangement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReasons, setDisputeReasons] = useState<string[]>([]);
  const [disputeNotes, setDisputeNotes] = useState('');

  const load = () => {
    setError(null);
    Promise.all([apiFetch<CaseDetail>(`/cases/${caseId}`), apiFetch<MessageItem[]>(`/cases/${caseId}/messages`)])
      .then(([c, m]) => {
        setKase(c);
        setMessages(m);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load this case'));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  // Only ARRIVAL_SUPPORT cases have arrangements — fetched separately
  // once `kase` confirms the service type, same reasoning as the Ops
  // case page. Read-only here by design: "the frontend should never
  // imply guaranteed availability before confirmation" — a customer only
  // ever reads what staff actually confirmed, never sets it themselves.
  useEffect(() => {
    if (kase?.serviceType !== 'ARRIVAL_SUPPORT') return;
    apiFetch<ArrivalArrangement[]>(`/cases/${caseId}/arrival-arrangements`).then(setArrangements).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kase?.serviceType, caseId]);

  if (error && !kase) return <ErrorState message={error} onRetry={load} />;
  if (!kase) {
    return (
      <div className="space-y-4">
        <div className="h-40 animate-pulse rounded-3xl bg-forest/5" />
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="h-96 animate-pulse rounded-2xl bg-forest/5 lg:col-span-3" />
          <div className="h-96 animate-pulse rounded-2xl bg-forest/5 lg:col-span-2" />
        </div>
      </div>
    );
  }

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const status = kase.status;
  // getCaseDetail returns every quote/invoice version ever created —
  // latest is authoritative (same convention as scopes elsewhere in
  // this app). No FX-lock or SC-toggle fields on the real Quote model
  // (see CaseDetailParts.tsx's QuoteCard comment).
  const quote = [...kase.quotes].sort((a, b) => (a.acceptedAt ?? '') < (b.acceptedAt ?? '') ? 1 : -1)[0] ?? kase.quotes[kase.quotes.length - 1];
  const invoice = [...kase.invoices].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  const payments = kase.invoices.flatMap((i) => i.payments);
  const checkoutDone = payments.some((p) => p.status === 'PAID');
  const report = kase.reports[kase.reports.length - 1];

  const overdue = kase.slaTargetAt && new Date(kase.slaTargetAt).getTime() < Date.now() && !NOT_OVERDUE_ELIGIBLE.has(status);

  const activeAssignment = kase.assignments.find((a) => a.agent || a.provider);
  const assignedName = activeAssignment?.agent?.fullName ?? activeAssignment?.provider?.fullName;
  const scheduledFor = kase.assignments.find((a) => a.scheduledFor)?.scheduledFor;

  const submitDispute = async () => {
    if (disputeReasons.length === 0) {
      setError('Select at least one disputed item');
      return;
    }
    const subject = disputeReasons.join('; ');
    const detail = disputeNotes.trim() || 'No further details provided.';
    await run('dispute', () => apiFetch(`/cases/${caseId}/disputes`, { method: 'POST', body: JSON.stringify({ subject, detail }) }));
    setDisputeOpen(false);
    setDisputeReasons([]);
    setDisputeNotes('');
  };

  const acceptQuote = () => {
    if (!quote) return;
    run('accept', () => apiFetch(`/quotes/${quote.id}/accept`, { method: 'POST' }));
  };

  const payNow = async () => {
    if (!invoice) return;
    setBusy('pay');
    setError(null);
    try {
      const res = await apiFetch<{ authorizationUrl: string; dryRun: boolean }>(`/invoices/${invoice.id}/pay`, { method: 'POST' });
      if (res.dryRun) {
        setError('Payments aren’t configured in this environment yet (dry-run mode) — no charge was made. A real deployment would redirect to Paystack checkout now.');
        setBusy(null);
      } else {
        window.location.href = res.authorizationUrl;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(null);
    }
  };

  const approve = (action: 'APPROVED' | 'REQUEST_ADDITIONAL_WORK', note?: string) =>
    run(action === 'APPROVED' ? 'approve' : 'rework', () => apiFetch(`/cases/${caseId}/approvals`, { method: 'POST', body: JSON.stringify({ action, note }) }));

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-forest p-6 text-ivory shadow-xl shadow-forest/20 sm:p-8">
        <div className="absolute inset-0 pattern-grid-dark" />
        <div className="pointer-events-none absolute -right-20 -top-28 size-80 rounded-full bg-gold/15 blur-3xl" />
        <div className="relative">
          <button onClick={() => router.push('/dashboard')} className="flex items-center gap-1.5 text-xs font-medium text-ivory/60 transition-colors hover:text-ivory">
            <ArrowLeft className="size-3.5" />
            All cases
          </button>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-sm font-semibold tracking-wide text-gold-light">{kase.caseNumber}</span>
                <StatusPill status={status} />
                {overdue && (
                  <Badge className="border-red-300/40 bg-red-500/20 text-red-200">
                    <AlertTriangle className="size-3" />
                    Overdue
                  </Badge>
                )}
              </div>
              <h1 className="mt-3 font-display text-2xl font-semibold leading-snug sm:text-3xl">{kase.description}</h1>
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ivory/70">
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-4 text-gold-light" />
                  {kase.location}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="size-4 text-gold-light" />
                  Created {formatDate(kase.createdAt)}
                </span>
                {assignedName && (
                  <span className="flex items-center gap-1.5">
                    <UserRound className="size-4 text-gold-light" />
                    {assignedName}
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-ivory/10 bg-ivory/5 px-5 py-4 text-right">
              <p className="text-[11px] uppercase tracking-wider text-ivory/50">Next action</p>
              <p className="mt-1 max-w-[220px] text-sm font-medium text-ivory/90">{kase.nextAction ?? 'Awaiting next step'}</p>
              {kase.nextActionDueAt && <p className="mt-1 text-[11px] text-ivory/50">due {formatDateTime(kase.nextActionDueAt)}</p>}
            </div>
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-gold/40 bg-gold/5 p-4">
        {status === 'QUOTED' && quote && !quote.acceptedAt && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-forest">Your quote is ready</p>
              <p className="text-xs text-forest/60">Review the line items below and accept to create your invoice.</p>
            </div>
            <Button className="bg-forest text-ivory hover:bg-forest-deep" disabled={busy !== null} onClick={acceptQuote}>
              {busy === 'accept' ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Accept quote
            </Button>
          </div>
        )}

        {status === 'AWAITING_PAYMENT' && invoice && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-forest">Awaiting payment</p>
              <p className="text-xs text-forest/60">Complete checkout to schedule your representative.</p>
            </div>
            <Button className="bg-gold font-semibold text-forest-deep hover:bg-gold-light" disabled={busy !== null} onClick={payNow}>
              {busy === 'pay' ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
              Pay {naira(invoice.amount)}
            </Button>
          </div>
        )}

        {status === 'CUSTOMER_REVIEW' && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-forest">Your report is ready — review the evidence &amp; findings below</p>
            <div className="flex flex-wrap gap-2.5">
              <Button className="bg-forest text-ivory hover:bg-forest-deep" disabled={busy !== null} onClick={() => approve('APPROVED')}>
                {busy === 'approve' ? <Loader2 className="size-4 animate-spin" /> : <FileCheck2 className="size-4" />}
                Approve report
              </Button>
              <Button
                variant="outline"
                className="border-forest/20 text-forest hover:bg-forest/5"
                disabled={busy !== null}
                onClick={() => {
                  const reason = window.prompt('What additional work do you need?');
                  if (!reason) return;
                  approve('REQUEST_ADDITIONAL_WORK', reason);
                }}
              >
                <RotateCcw className="size-4" />
                Request changes
              </Button>
              <Button variant="outline" className="border-red-300 bg-red-50 text-red-700 hover:bg-red-100" disabled={busy !== null} onClick={() => setDisputeOpen(true)}>
                <Scale className="size-4" />
                Dispute report
              </Button>
            </div>
          </div>
        )}

        {/* Hold/resume are staff-only in this backend (@Roles(...OPS_ROLES)
            on POST /cases/:caseId/hold|resume) — unlike the prototype,
            which let the customer pause/resume their own case directly.
            Verified by hitting both as a real customer: 403 Forbidden.
            Informational only here; ask the ASOJU team via the message
            thread below to pause a case. */}
        {status === 'ON_HOLD' && (
          <div>
            <p className="text-sm font-semibold text-forest">Case is on hold</p>
            <p className="text-xs text-forest/60">Paused by the ASOJU team. Message them below if you need it resumed sooner.</p>
          </div>
        )}
      </section>

      {error && <p className="error-text">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <section className="rounded-2xl border border-forest/10 bg-white p-5 shadow-sm">
            <h2 className="font-display text-lg font-semibold text-forest">Overview</h2>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ['Priority', kase.priority],
                ['Plan', PLAN_LABEL[kase.tier] ?? kase.tier],
                ['Payment', checkoutDone ? 'Paid' : kase.paymentStatus],
              ].map(([l, val]) => (
                <div key={l} className="rounded-xl border border-forest/8 bg-ivory/50 p-3.5">
                  <p className="text-[11px] uppercase tracking-wide text-forest/45">{l}</p>
                  <p className="mt-0.5 text-sm font-semibold text-forest">{val}</p>
                </div>
              ))}
            </div>
            {scheduledFor && (
              <p className="mt-4 flex items-center gap-2 text-sm text-forest/70">
                <CalendarCheck className="size-4 text-forest" />
                Scheduled visit: {formatDateTime(scheduledFor)}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-forest/10 bg-white p-5 shadow-sm">
            <h2 className="font-display text-lg font-semibold text-forest">Field checklist</h2>
            {kase.tasks.length > 0 ? (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {kase.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2.5 text-sm text-forest/70">
                    <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border', t.isComplete ? 'border-emerald-300 bg-emerald-50 text-emerald-600' : 'border-forest/20 text-transparent')}>
                      <CheckCircle2 className="size-3.5" />
                    </span>
                    {t.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-forest/50">The checklist populates once your case moves past triage.</p>
            )}
          </section>

          {kase.serviceType === 'ARRIVAL_SUPPORT' && arrangements && arrangements.length > 0 && (
            <section className="rounded-2xl border border-forest/10 bg-white p-5 shadow-sm">
              <h2 className="font-display text-lg font-semibold text-forest">Transport &amp; accommodation</h2>
              <p className="mt-1 text-sm text-forest/50">
                We coordinate this directly and only show it here once it&apos;s actually confirmed — never a
                guess at availability.
              </p>
              <ul className="mt-3 space-y-2">
                {arrangements.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-forest/70">{a.type === 'AIRPORT_TRANSPORT' ? 'Airport transport' : 'Accommodation'}</span>
                    <Badge
                      className={cn(
                        'border',
                        ARRANGEMENT_CONFIRMED_STATUSES.has(a.status)
                          ? 'border-emerald-200 bg-emerald-100 text-emerald-800'
                          : 'border-amber-200 bg-amber-100 text-amber-800',
                      )}
                    >
                      {ARRANGEMENT_STATUS_LABEL[a.status] ?? a.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-2xl border border-forest/10 bg-white p-5 shadow-sm">
            <h2 className="mb-5 font-display text-lg font-semibold text-forest">Case timeline</h2>
            <Timeline history={kase.statusHistory} />
          </section>

          <MessageThread
            messages={messages}
            currentUserId={currentUserId}
            busy={busy === 'send'}
            onSend={(body) => {
              setBusy('send');
              apiFetch(`/cases/${caseId}/messages`, { method: 'POST', body: JSON.stringify({ body }) })
                .then(() => apiFetch<MessageItem[]>(`/cases/${caseId}/messages`))
                .then(setMessages)
                .catch((e) => setError(e instanceof Error ? e.message : 'Failed to send'))
                .finally(() => setBusy(null));
            }}
          />
        </div>

        <div className="space-y-6 lg:col-span-2">
          {quote && <QuoteCard quote={quote} accepted={Boolean(quote.acceptedAt)} busy={busy === 'accept'} onAccept={status === 'QUOTED' ? acceptQuote : undefined} />}

          {(invoice || payments.length > 0) && (
            <section className="rounded-2xl border border-forest/10 bg-white p-5 shadow-sm">
              <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-forest">
                <Receipt className="size-4.5 text-clay" />
                Invoice &amp; payment
              </h2>
              {invoice && (
                <div className="mt-4 flex items-center justify-between rounded-xl border border-forest/8 bg-ivory/50 p-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-forest/45">Invoice · {formatDate(invoice.createdAt)}</p>
                    <p className="font-display text-xl font-bold text-forest">{naira(invoice.amount)}</p>
                  </div>
                  <Badge className={cn('border', checkoutDone ? 'border-emerald-200 bg-emerald-100 text-emerald-800' : 'border-amber-200 bg-amber-100 text-amber-800')}>{checkoutDone ? 'Paid' : 'Pending'}</Badge>
                </div>
              )}
              {payments.length > 0 && (
                <div className="mt-3 space-y-2">
                  {payments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-xl border border-forest/8 p-3.5 text-sm">
                      <span className="flex items-center gap-2 text-forest/70">
                        <CircleDollarSign className="size-4 text-forest" />
                        {p.provider} · {p.providerReference}
                      </span>
                      <span className={cn('text-xs font-semibold', p.status === 'PAID' ? 'text-emerald-600' : 'text-amber-600')}>{p.status}</span>
                    </div>
                  ))}
                  <p className="text-[11px] text-forest/45">Payment status is driven only by the provider&apos;s verified webhook — never by screenshots.</p>
                </div>
              )}
            </section>
          )}

          {kase.evidence.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-forest">
                <ClipboardCheck className="size-4.5 text-clay" />
                Evidence ({kase.evidence.length})
              </h2>
              <EvidenceGrid evidence={kase.evidence} />
            </section>
          )}

          {report && <ReportCard report={report} />}

          <div className="rounded-2xl border border-forest/10 bg-white/60 p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-forest">
              <ShieldCheck className="size-4 text-forest" />
              Why you can trust this case
            </p>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-forest/60">
              <li>· Every transition is recorded in an append-only audit trail.</li>
              <li>· Evidence is server-timestamped and QC-reviewed before you see it.</li>
              <li>· No report ships with unresolved issues hidden.</li>
              <li>· Professional opinions come only from licensed professionals coordinated through ASOJU.</li>
            </ul>
          </div>
        </div>
      </div>

      <Dialog open={disputeOpen} onOpenChange={setDisputeOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="size-5 text-clay" />
              Dispute this report
            </DialogTitle>
            <DialogDescription>The report will be locked and a rework scheduled on the disputed items. Select everything that&apos;s wrong:</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {DISPUTE_REASONS.map((r) => {
              const on = disputeReasons.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setDisputeReasons((cur) => (on ? cur.filter((x) => x !== r) : [...cur, r]))}
                  className={cn('flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors', on ? 'border-clay bg-clay/10 text-clay' : 'border-forest/10 bg-white text-forest hover:border-forest/30')}
                >
                  <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border', on ? 'border-clay bg-clay text-white' : 'border-forest/25')}>{on && <CheckCircle2 className="size-3.5" />}</span>
                  {r}
                </button>
              );
            })}
            <textarea
              value={disputeNotes}
              onChange={(e) => setDisputeNotes(e.target.value)}
              rows={3}
              placeholder="Add details — what did you expect, and what did you find?"
              className="w-full resize-none rounded-xl border border-forest/15 bg-ivory/50 px-4 py-3 text-sm outline-none transition-colors focus:border-forest/40 focus:bg-white"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDisputeOpen(false)}>
              Cancel
            </Button>
            <Button className="bg-clay text-ivory hover:bg-clay/90" disabled={busy === 'dispute'} onClick={submitDispute}>
              {busy === 'dispute' ? <Loader2 className="size-4 animate-spin" /> : <Scale className="size-4" />}
              File dispute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
