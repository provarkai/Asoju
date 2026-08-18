'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CalendarClock,
  Camera,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Loader2,
  Lock,
  MessageSquare,
  ShieldCheck,
  StickyNote,
  Video,
} from 'lucide-react';
import { formatDateTime, statusLabel } from '@/lib/statusMeta';
import { naira } from '@/lib/format';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Timeline                                                           */
/* ------------------------------------------------------------------ */

export interface HistoryEvent {
  id: string;
  fromStatus?: string | null;
  toStatus: string;
  reason?: string | null;
  createdAt: string;
}

// No actorName here — CaseStatusHistory.changedById has no joined User
// in getCaseDetail's include, and resolving it isn't worth another round
// trip just for a badge. The prototype's version had one via its Convex
// schema; dropped rather than faked.
export function Timeline({ history }: { history: HistoryEvent[] }) {
  return (
    <ol className="relative space-y-0">
      {history.map((h, i) => {
        const isLast = i === history.length - 1;
        return (
          <li key={h.id} className="relative flex gap-4 pb-7 last:pb-0">
            {!isLast && <span className="absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px bg-forest/15" />}
            <span className={cn('relative z-10 mt-1 size-[23px] shrink-0 rounded-full border-4 border-white shadow-sm', isLast ? 'bg-gold' : 'bg-forest/25')} />
            <div className="min-w-0 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-sm font-semibold text-forest">{statusLabel(h.toStatus)}</p>
                <span className="text-xs text-forest/45">{formatDateTime(h.createdAt)}</span>
              </div>
              {h.reason && <p className="mt-0.5 text-sm text-forest/60">{h.reason}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Quote                                                              */
/* ------------------------------------------------------------------ */

export interface QuoteLineData {
  category: string;
  label: string;
  amount: number;
}

export interface QuoteData {
  id: string;
  amount: number;
  currency: string;
  baseAmount: number | null;
  nonServiceFeeAmount: number | null;
  discountPercent: number | null;
  discountAmount: number | null;
  scAppliedNgn: number | null;
  lines: QuoteLineData[];
  expiresAt: string | null;
  acceptedAt: string | null;
  // "converted at the current rate" — USD->NGN rate this quote's
  // baseAmount was locked against (informational only, see
  // Quote.lockedFxRate's schema comment). Used below to show the
  // customer's own billingCurrency equivalent — never a second payable
  // amount, the NGN total above stays authoritative.
  lockedFxRate: number | null;
  sourceCurrency: string | null;
}

const LINE_TONE: Record<string, string> = {
  ASOJU_SERVICE_FEE: 'text-forest',
  EXTERNAL_COST: 'text-forest/70',
  THIRD_PARTY_PROFESSIONAL: 'text-forest/70',
  TAX_STATUTORY: 'text-forest/70',
};

const LINE_CATEGORY_LABEL: Record<string, string> = {
  ASOJU_SERVICE_FEE: 'ASOJU service fee',
  EXTERNAL_COST: 'External cost',
  THIRD_PARTY_PROFESSIONAL: 'Third-party professional',
  TAX_STATUTORY: 'Tax / statutory',
};

// No useSC toggle — CommerceService.acceptQuote applies any eligible
// Service Credit automatically server-side (re-validated at accept time,
// not a customer choice at this screen). Same reasoning removed the
// prototype's AI-generated instant-quote flow: this app keeps quoting
// decisions off the client.
export function QuoteCard({ quote, onAccept, busy, accepted }: { quote: QuoteData; onAccept?: () => void; busy?: boolean; accepted: boolean }) {
  const expired = Boolean(quote.expiresAt && new Date(quote.expiresAt).getTime() < Date.now());
  const discountAmount = quote.discountAmount ?? 0;
  const scApplied = quote.scAppliedNgn ?? 0;

  // "converted at the current rate" — only meaningful when this quote has
  // a real USD service-fee portion (baseAmount/lockedFxRate, set
  // whenever there's an ASOJU_SERVICE_FEE line) and the signed-in
  // customer's own billingCurrency isn't USD (GET /me/fx-rate returns
  // {currency:'USD', rate:1} for USD/unset accounts — skip the fetch
  // rather than show a redundant "≈ $X" next to an already-USD-priced
  // figure... except this quote's own total is NGN, so USD still shows
  // once; only a second non-USD conversion would be redundant).
  const [converted, setConverted] = useState<{ currency: string; amount: number } | null>(null);
  useEffect(() => {
    setConverted(null);
    if (!quote.lockedFxRate || quote.sourceCurrency !== 'USD' || !quote.baseAmount) return;
    let cancelled = false;
    apiFetch<{ currency: string; rate: number }>('/me/fx-rate')
      .then((res) => {
        if (cancelled || res.currency === 'USD') return;
        const usdEquivalent = quote.baseAmount! / quote.lockedFxRate!;
        setConverted({ currency: res.currency, amount: usdEquivalent * res.rate });
      })
      .catch(() => {
        // Live FX unavailable — this is purely informational, so fail
        // silently rather than showing an error next to a real quote.
      });
    return () => {
      cancelled = true;
    };
  }, [quote.lockedFxRate, quote.sourceCurrency, quote.baseAmount]);

  return (
    <div className="overflow-hidden rounded-2xl border border-forest/10 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-forest/8 bg-forest px-5 py-3.5 text-ivory">
        <p className="flex items-center gap-2 font-display text-base font-semibold">
          <FileText className="size-4 text-gold-light" />
          Quote
        </p>
        {quote.expiresAt && <span className="text-xs text-ivory/70">valid until {formatDateTime(quote.expiresAt)}</span>}
      </div>
      <div className="divide-y divide-forest/8 px-5">
        {quote.lines.map((line, i) => (
          <div key={i} className="flex items-start justify-between gap-4 py-3">
            <div>
              <p className={cn('text-sm font-medium', LINE_TONE[line.category] ?? 'text-forest')}>{line.label}</p>
              <p className="text-[11px] uppercase tracking-wide text-forest/40">{LINE_CATEGORY_LABEL[line.category] ?? line.category}</p>
            </div>
            <span className="text-sm font-semibold text-forest">{naira(line.amount)}</span>
          </div>
        ))}
        {discountAmount > 0 && (
          <div className="flex items-start justify-between gap-4 py-3">
            <p className="text-sm font-medium text-emerald-700">Plan discount{quote.discountPercent ? ` (${quote.discountPercent}%)` : ''}</p>
            <span className="text-sm font-semibold text-emerald-700">−{naira(discountAmount)}</span>
          </div>
        )}
        {scApplied > 0 && (
          <div className="flex items-start justify-between gap-4 py-3">
            <p className="text-sm font-medium text-gold">Service Credit applied</p>
            <span className="text-sm font-semibold text-gold">−{naira(scApplied)}</span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-forest/8 bg-ivory/60 px-5 py-3.5">
        <span className="text-sm text-forest/60">
          Service fee {naira(quote.baseAmount ?? quote.amount)} · pass-through {naira(quote.nonServiceFeeAmount ?? 0)}
        </span>
        <div className="text-right">
          <p className="font-display text-2xl font-bold text-forest">
            {naira(quote.amount)}
            <span className="ml-1 text-xs font-medium text-forest/45">{quote.currency}</span>
          </p>
          {converted && (
            <p className="text-xs text-forest/50">
              ≈ {converted.currency} {converted.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          )}
        </div>
      </div>
      <div className="px-5 pb-5">
        {accepted ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 py-2.5 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="size-4" /> Accepted — invoice issued
          </div>
        ) : expired ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 py-2.5 text-sm font-medium text-red-600">
            <CalendarClock className="size-4" /> Quote expired
          </div>
        ) : onAccept ? (
          <Button className="w-full bg-forest text-ivory hover:bg-forest-deep" onClick={onAccept} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Accept quote &amp; create invoice
          </Button>
        ) : (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-forest/10 bg-ivory/60 py-2.5 text-sm font-medium text-forest/60">
            <Lock className="size-3.5" /> Awaiting customer decision
          </div>
        )}
        <p className="mt-2.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[11px] text-forest/45">
          <Lock className="size-3" />
          Transport &amp; logistics included in the ASOJU service fee.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Evidence                                                           */
/* ------------------------------------------------------------------ */

export interface EvidenceItem {
  id: string;
  type: string;
  description?: string | null;
  trustLabel: string;
  viewUrl?: string;
  capturedAt?: string | null;
  createdAt: string;
}

const TRUST_TONE: Record<string, string> = {
  ASOJU_VERIFIED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  PROFESSIONALLY_REVIEWED: 'bg-blue-100 text-blue-800 border-blue-200',
  CUSTOMER_PROVIDED: 'bg-amber-100 text-amber-800 border-amber-200',
  THIRD_PARTY_STATEMENT: 'bg-violet-100 text-violet-800 border-violet-200',
  NOT_INDEPENDENTLY_VERIFIED: 'bg-slate-200 text-slate-600 border-slate-300',
};

const TRUST_LABEL: Record<string, string> = {
  ASOJU_VERIFIED: 'ASOJU Verified',
  PROFESSIONALLY_REVIEWED: 'Professionally Reviewed',
  CUSTOMER_PROVIDED: 'Customer Provided',
  THIRD_PARTY_STATEMENT: 'Third-Party Statement',
  NOT_INDEPENDENTLY_VERIFIED: 'Not Independently Verified',
};

// No `title` field on the real Evidence model (the prototype's schema
// had one) — the type icon + description carry that role instead.
const TYPE_LABEL: Record<string, string> = {
  PHOTO: 'Photo',
  VIDEO: 'Video',
  DOCUMENT: 'Document',
  VOICE: 'Voice note',
  LOCATION: 'Location check-in',
  NOTE: 'Note',
};

export function EvidenceGrid({ evidence }: { evidence: EvidenceItem[] }) {
  if (evidence.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-forest/20 bg-white/60 px-5 py-8 text-sm text-forest/50">
        <Camera className="size-5" />
        Evidence appears here as your representative captures it on site.
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {evidence.map((ev) => (
        <div key={ev.id} className="overflow-hidden rounded-2xl border border-forest/10 bg-white shadow-sm">
          {ev.viewUrl && ev.type === 'PHOTO' ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL; next/image's remote-domain allowlist isn't worth it here
            <img src={ev.viewUrl} alt={TYPE_LABEL[ev.type] ?? ev.type} className="aspect-[16/10] w-full object-cover" />
          ) : (
            <div className="flex aspect-[16/10] w-full items-center justify-center bg-sand/60">
              {ev.type === 'NOTE' ? <StickyNote className="size-8 text-forest/40" /> : ev.type === 'VIDEO' ? <Video className="size-8 text-forest/40" /> : <ImageIcon className="size-8 text-forest/40" />}
            </div>
          )}
          <div className="p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-forest">{TYPE_LABEL[ev.type] ?? ev.type}</p>
              <span className="flex items-center gap-1 text-[11px] text-forest/45">
                {ev.type === 'PHOTO' ? <ImageIcon className="size-3" /> : ev.type === 'VIDEO' ? <Video className="size-3" /> : ev.type === 'NOTE' ? <StickyNote className="size-3" /> : <FileText className="size-3" />}
                {formatDateTime(ev.capturedAt ?? ev.createdAt)}
              </span>
            </div>
            {ev.description && <p className="mt-1 text-sm leading-relaxed text-forest/60">{ev.description}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge className={cn('border text-[10px] font-medium', TRUST_TONE[ev.trustLabel] ?? '')}>
                <ShieldCheck className="size-3" />
                {TRUST_LABEL[ev.trustLabel] ?? ev.trustLabel}
              </Badge>
              <span className="text-[10px] text-forest/40">Server-timestamped · QC reviewed</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Report                                                             */
/* ------------------------------------------------------------------ */

export interface ReportData {
  id: string;
  summary: string;
  findings: unknown;
  qcOutcome?: string | null;
  limitation?: string | null;
}

// findings is a raw Json column (Report.findings) — shape isn't
// enforced by the schema, so this renders defensively: an array of
// {label, detail} (what QC is expected to write) if that's what's
// there, otherwise falls back to plain key/value pairs.
function renderFindings(findings: unknown): { label: string; detail: string }[] {
  if (Array.isArray(findings)) {
    return findings
      .filter((f): f is { label: unknown; detail: unknown } => typeof f === 'object' && f !== null)
      .map((f) => ({ label: String(f.label ?? ''), detail: String(f.detail ?? '') }));
  }
  if (findings && typeof findings === 'object') {
    return Object.entries(findings as Record<string, unknown>).map(([label, detail]) => ({ label, detail: String(detail) }));
  }
  return [];
}

export function ReportCard({ report }: { report: ReportData }) {
  const findings = renderFindings(report.findings);
  return (
    <div className="overflow-hidden rounded-2xl border border-forest/10 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-forest/8 bg-forest px-5 py-3.5 text-ivory">
        <p className="flex items-center gap-2 font-display text-base font-semibold">
          <FileText className="size-4 text-gold-light" />
          Inspection report
        </p>
        <Badge className="border-emerald-300/40 bg-emerald-400/20 text-emerald-200">QC {(report.qcOutcome ?? 'approved').toLowerCase().replace(/_/g, ' ')}</Badge>
      </div>
      <div className="p-5">
        <p className="text-sm leading-relaxed text-forest/75">{report.summary}</p>
        {findings.length > 0 && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {findings.map((f) => (
              <div key={f.label} className="rounded-xl border border-forest/8 bg-ivory/60 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-clay">{f.label}</p>
                <p className="mt-1 text-sm text-forest/75">{f.detail}</p>
              </div>
            ))}
          </div>
        )}
        {report.limitation && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-800">
            <strong>Limitation:</strong> {report.limitation}
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Messages                                                           */
/* ------------------------------------------------------------------ */

export interface MessageItem {
  id: string;
  sender?: { id: string; email: string | null; role: string } | null;
  body: string;
  createdAt: string;
}

export function MessageThread({ messages, onSend, busy, currentUserId }: { messages: MessageItem[]; onSend: (body: string) => void; busy: boolean; currentUserId?: string }) {
  const [draft, setDraft] = useState('');
  return (
    <div className="overflow-hidden rounded-2xl border border-forest/10 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-forest/8 bg-forest px-5 py-3.5 text-ivory">
        <MessageSquare className="size-4 text-gold-light" />
        <p className="font-display text-base font-semibold">Messages</p>
      </div>
      <div className="max-h-[340px] space-y-4 overflow-y-auto p-5">
        {messages.length === 0 && <p className="text-sm text-forest/50">No messages yet — say hello to your representative.</p>}
        {messages.map((m) => {
          const mine = m.sender?.id === currentUserId;
          return (
            <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[80%] rounded-2xl px-4 py-2.5', mine ? 'rounded-br-sm bg-forest text-ivory' : 'rounded-bl-sm border border-forest/10 bg-ivory text-forest')}>
                <p className="text-[11px] font-semibold opacity-70">
                  {mine ? 'You' : (m.sender?.email ?? 'ASOJU team')}
                  <span className="ml-2 font-normal opacity-50">{formatDateTime(m.createdAt)}</span>
                </p>
                <p className="mt-0.5 text-sm leading-relaxed">{m.body}</p>
              </div>
            </div>
          );
        })}
      </div>
      <form
        className="flex items-center gap-2 border-t border-forest/8 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim() || busy) return;
          onSend(draft.trim());
          setDraft('');
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the ASOJU team…"
          className="h-10 flex-1 rounded-xl border border-forest/15 bg-ivory/50 px-3.5 text-sm outline-none transition-colors focus:border-forest/40 focus:bg-white"
        />
        <Button type="submit" size="sm" className="bg-forest text-ivory hover:bg-forest-deep" disabled={!draft.trim() || busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : 'Send'}
        </Button>
      </form>
    </div>
  );
}
