// ─── Admin Dashboard Shared Types & Helpers ──────────────────────────────

export type AdminSection =
  | 'command-center'
  | 'customers'
  | 'cases'
  | 'operations'
  | 'finance'
  | 'analytics'
  | 'audit'
  | 'messages'
  | 'outbox'
  | 'system'
  | 'trust'
  | 'care-plans'
  | 'tracking'
  | 'reports'
  | 'sos';

export interface DashboardKPIs {
  totalCustomers: number;
  activeCases: number;
  openCases: number;
  completedToday: number;
  activeMissions: number;
  totalRevenue: number;
  pendingPayments: number;
}

export interface CaseStatusBreakdown {
  status: string;
  count: number;
}

export interface ServiceTypeBreakdown {
  serviceCode: string;
  count: number;
}

export interface RecentActivityItem {
  id: string;
  eventType: string;
  title: string;
  actorType: string;
  actorName: string;
  createdAt: string;
  case: { caseNumber: string; title: string };
}

export interface SLAAtRiskCase {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  priority: string;
  slaDeadline: string | null;
  customer: { name: string };
}

export interface DashboardData {
  kpis: DashboardKPIs;
  casesByStatus: CaseStatusBreakdown[];
  casesByServiceType: ServiceTypeBreakdown[];
  recentActivity: RecentActivityItem[];
  slaAtRiskCases: SLAAtRiskCase[];
}

// ─── Status Colors ──────────────────────────────────────────────────────

export const CASE_STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-slate-100 text-slate-700 border-slate-200',
  QUOTED: 'bg-amber-100 text-amber-800 border-amber-200',
  PAYMENT_PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
  ACCEPTED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  IN_PROGRESS: 'bg-sky-100 text-sky-800 border-sky-200',
  UNDER_REVIEW: 'bg-orange-100 text-orange-800 border-orange-200',
  COMPLETED: 'bg-green-100 text-green-800 border-green-200',
  CANCELLED: 'bg-red-100 text-red-800 border-red-200',
  FAILED: 'bg-red-100 text-red-800 border-red-200',
};

export const PRIORITY_STYLES: Record<string, string> = {
  NORMAL: 'bg-slate-100 text-slate-700 border-slate-200',
  URGENT: 'bg-amber-100 text-amber-800 border-amber-200',
  CRITICAL: 'bg-red-100 text-red-800 border-red-200',
  HIGH: 'bg-red-100 text-red-800 border-red-200',
};

export const MISSION_STATE_STYLES: Record<string, string> = {
  ACCEPTED: 'bg-slate-100 text-slate-700 border-slate-200',
  EN_ROUTE: 'bg-amber-100 text-amber-800 border-amber-200',
  ON_SITE: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  EXECUTING: 'bg-sky-100 text-sky-800 border-sky-200',
  SUBMITTING: 'bg-violet-100 text-violet-800 border-violet-200',
  SUBMITTED: 'bg-slate-100 text-slate-700 border-slate-200',
  QC_REVIEW: 'bg-orange-100 text-orange-800 border-orange-200',
  COMPLETED: 'bg-green-100 text-green-800 border-green-200',
  ESCALATED: 'bg-red-100 text-red-800 border-red-200',
  PAUSED: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  REASSIGNED: 'bg-gray-100 text-gray-700 border-gray-200',
  REWORK: 'bg-rose-100 text-rose-800 border-rose-200',
  CANCELLED: 'bg-red-100 text-red-800 border-red-200',
  FAILED: 'bg-red-200 text-red-900 border-red-300',
};

export const PAYMENT_STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
  VERIFIED: 'bg-green-100 text-green-800 border-green-200',
  FAILED: 'bg-red-100 text-red-800 border-red-200',
  REFUNDED: 'bg-slate-100 text-slate-700 border-slate-200',
};

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(iso);
}

export function getStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

// ─── Chart Color Palette ────────────────────────────────────────────────

export const CHART_COLORS = [
  '#10b981', // emerald
  '#f59e0b', // amber
  '#0ea5e9', // sky
  '#f43f5e', // rose
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f97316', // orange
  '#ec4899', // pink
];
