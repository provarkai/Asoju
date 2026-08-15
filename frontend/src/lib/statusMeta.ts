import { humanCaseStatus } from './case-status';

/** Visual tone/dot per CaseStatus, layered on top of case-status.ts's
 * existing human labels (the single translation point for status text —
 * this file doesn't duplicate label copy, only adds color). */
const TONE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-200',
  SUBMITTED: 'bg-sky-100 text-sky-800 border-sky-200',
  UNDER_REVIEW: 'bg-amber-100 text-amber-800 border-amber-200',
  QUOTED: 'bg-violet-100 text-violet-800 border-violet-200',
  AWAITING_PAYMENT: 'bg-orange-100 text-orange-800 border-orange-200',
  SCHEDULED: 'bg-teal-100 text-teal-800 border-teal-200',
  ASSIGNED: 'bg-teal-100 text-teal-800 border-teal-200',
  IN_PROGRESS: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  EVIDENCE_SUBMITTED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  QUALITY_CONTROL: 'bg-lime-100 text-lime-800 border-lime-200',
  CUSTOMER_REVIEW: 'bg-blue-100 text-blue-800 border-blue-200',
  ADDITIONAL_WORK: 'bg-rose-100 text-rose-800 border-rose-200',
  APPROVED: 'bg-green-100 text-green-800 border-green-200',
  COMPLETED: 'bg-green-100 text-green-800 border-green-200',
  CLOSED: 'bg-stone-200 text-stone-700 border-stone-300',
  ON_HOLD: 'bg-zinc-200 text-zinc-700 border-zinc-300',
};

const DOT: Record<string, string> = {
  DRAFT: 'bg-slate-400',
  SUBMITTED: 'bg-sky-500',
  UNDER_REVIEW: 'bg-amber-500',
  QUOTED: 'bg-violet-500',
  AWAITING_PAYMENT: 'bg-orange-500',
  SCHEDULED: 'bg-teal-500',
  ASSIGNED: 'bg-teal-500',
  IN_PROGRESS: 'bg-emerald-500',
  EVIDENCE_SUBMITTED: 'bg-emerald-500',
  QUALITY_CONTROL: 'bg-lime-500',
  CUSTOMER_REVIEW: 'bg-blue-500',
  ADDITIONAL_WORK: 'bg-rose-500',
  APPROVED: 'bg-green-600',
  COMPLETED: 'bg-green-600',
  CLOSED: 'bg-stone-400',
  ON_HOLD: 'bg-zinc-400',
};

const DEFAULT_TONE = 'bg-muted text-muted-foreground border-border';
const DEFAULT_DOT = 'bg-muted-foreground';

export function statusTone(status: string): string {
  return TONE[status] ?? DEFAULT_TONE;
}

export function statusDot(status: string): string {
  return DOT[status] ?? DEFAULT_DOT;
}

export function statusLabel(status: string): string {
  return humanCaseStatus(status);
}

// Compact badge labels — same idea as SERVICE_LABELS in case-status.ts
// but short enough for a case-card chip.
const SERVICE_SHORT: Record<string, string> = {
  PROPERTY_INSPECTION: 'Property check',
  CONSTRUCTION_SUPERVISION: 'Site supervision',
  ASSET_INSPECTION: 'Asset check',
  FAMILY_SUPPORT: 'Family errands',
  PROCUREMENT: 'Procurement',
  BUSINESS_VERIFICATION: 'Business check',
  INVESTMENT_SUPPORT: 'Investment check',
  AGRICULTURE_SUPPORT: 'Agriculture check',
  BEREAVEMENT_SUPPORT: 'Funeral logistics',
};

export function shortServiceLabel(serviceType: string): string {
  return SERVICE_SHORT[serviceType] ?? serviceType;
}

export function timeAgo(ts: string | number | Date): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function formatDate(ts: string | number | Date): string {
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
