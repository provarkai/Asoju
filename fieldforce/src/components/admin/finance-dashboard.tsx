'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Wallet,
  Banknote,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Send,
  Eye,
  Filter,
  ScrollText,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { authFetch } from '@/lib/auth-fetch';
import { formatNaira } from '@/lib/constants';
import { formatDateTime, formatDate } from './admin-types';

// ─── Custom Scrollbar Styles ──────────────────────────────────────────

const SCROLLBAR_CLASSES =
  'max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 [&::-webkit-scrollbar-track]:bg-transparent';

// ─── Types ──────────────────────────────────────────────────────────────

interface FinanceOverview {
  agentWalletBalance: number;
  totalPaidOut: number;
  pendingPayoutCount: number;
  pendingPayoutAmount: number;
  exceptionCount: number;
  criticalExceptionCount: number;
  paystackConfigured: boolean;
  accounts: LedgerAccount[];
}

interface LedgerAccount {
  id: string;
  name: string;
  accountType: string;
  balance: number;
  currency: string;
}

interface JournalEntry {
  id: string;
  entryDate: string;
  entryType: string;
  entityType: string;
  entityId: string;
  entityName: string;
  description: string;
  balanced: boolean;
  lines: JournalLine[];
}

interface JournalLine {
  id: string;
  accountId: string;
  accountName: string;
  entryType: 'DEBIT' | 'CREDIT';
  amount: number;
}

interface Payout {
  id: string;
  createdAt: string;
  agentId: string;
  agentName: string;
  amount: number;
  fee: number;
  netAmount: number;
  status: 'REQUESTED' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REVERSED';
  paystackReference: string | null;
  paystackMessage: string | null;
  processedAt: string | null;
}

interface FinanceException {
  id: string;
  createdAt: string;
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  entityType: string;
  entityId: string;
  entityName: string;
  description: string;
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED';
  resolvedAt: string | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── Status Color Maps ──────────────────────────────────────────────────

const PAYOUT_STATUS_STYLES: Record<string, string> = {
  REQUESTED: 'bg-amber-100 text-amber-800 border-amber-200',
  PROCESSING: 'bg-sky-100 text-sky-800 border-sky-200',
  SUCCESS: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  FAILED: 'bg-red-100 text-red-800 border-red-200',
  REVERSED: 'bg-purple-100 text-purple-800 border-purple-200',
};

const EXCEPTION_SEVERITY_STYLES: Record<string, string> = {
  LOW: 'bg-gray-100 text-gray-700 border-gray-200',
  MEDIUM: 'bg-amber-100 text-amber-800 border-amber-200',
  HIGH: 'bg-orange-100 text-orange-800 border-orange-200',
  CRITICAL: 'bg-red-100 text-red-800 border-red-200',
};

const EXCEPTION_STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-amber-100 text-amber-800 border-amber-200',
  RESOLVED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  DISMISSED: 'bg-gray-100 text-gray-600 border-gray-200',
};

// ─── Pagination Controls ──────────────────────────────────────────────

function PaginationControls({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-4 border-t">
      <p className="text-xs text-muted-foreground">
        Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 1 — Finance Overview
// ═══════════════════════════════════════════════════════════════════════════

function OverviewTab({ overview, loading }: { overview: FinanceOverview | null; loading: boolean }) {
  if (loading) return <OverviewSkeleton />;
  if (!overview) return <p className="text-sm text-muted-foreground">Failed to load overview.</p>;

  const cards = [
    {
      title: 'Agent Wallet Balance',
      value: formatNaira(overview.agentWalletBalance),
      icon: Wallet,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      sub: 'Total available across all agents',
    },
    {
      title: 'Total Paid Out',
      value: formatNaira(overview.totalPaidOut),
      icon: Banknote,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      sub: 'Successfully paid to agents',
    },
    {
      title: 'Pending Payouts',
      value: `${overview.pendingPayoutCount} requests`,
      icon: Clock,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
      sub: formatNaira(overview.pendingPayoutAmount),
    },
    {
      title: 'Finance Exceptions',
      value: `${overview.exceptionCount} total`,
      icon: AlertTriangle,
      color: overview.criticalExceptionCount > 0 ? 'text-red-600' : 'text-muted-foreground',
      bg: overview.criticalExceptionCount > 0 ? 'bg-red-50' : 'bg-muted/50',
      sub: overview.criticalExceptionCount > 0
        ? `${overview.criticalExceptionCount} critical ⚠️`
        : 'No critical issues',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Paystack Config Indicator */}
      <div className="flex items-center gap-2">
        {overview.paystackConfigured ? (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs gap-1.5">
            <ShieldCheck className="w-3 h-3" /> Paystack Configured
          </Badge>
        ) : (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs gap-1.5">
            <XCircle className="w-3 h-3" /> Paystack Not Configured
          </Badge>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.title} className="relative overflow-hidden">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {c.title}
                    </p>
                    <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
                    <p className="text-xs text-muted-foreground">{c.sub}</p>
                  </div>
                  <div className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-5 h-5 ${c.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Ledger Accounts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ledger Accounts</CardTitle>
          <CardDescription>Current balances across all accounts</CardDescription>
        </CardHeader>
        <CardContent>
          {overview.accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No ledger accounts found.</p>
          ) : (
            <div className={`space-y-0 ${SCROLLBAR_CLASSES}`}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Account</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.accounts.map((acc) => (
                    <TableRow key={acc.id}>
                      <TableCell className="text-sm font-medium">{acc.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {acc.accountType}
                        </Badge>
                      </TableCell>
                      <TableCell className={`text-sm text-right font-semibold ${acc.balance >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                        {formatNaira(acc.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-6 w-40" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-5 space-y-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 2 — Journal Entries
// ═══════════════════════════════════════════════════════════════════════════

function JournalEntriesTab() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [entityFilter, setEntityFilter] = useState<string>('ALL');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '20',
      });
      if (entityFilter !== 'ALL') params.set('entityType', entityFilter);
      const res = await authFetch(`/api/admin/finance/ledger?${params}`);
      if (!res.ok) throw new Error('Failed to fetch journal entries');
      const data: PaginatedResponse<JournalEntry> = await res.json();
      setEntries(data.data);
      setTotalPages(data.totalPages);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load journal entries');
    } finally {
      setLoading(false);
    }
  }, [page, entityFilter]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <Select value={entityFilter} onValueChange={(v) => { setEntityFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <SelectValue placeholder="Entity type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Entities</SelectItem>
            <SelectItem value="AGENT">Agent</SelectItem>
            <SelectItem value="CUSTOMER">Customer</SelectItem>
            <SelectItem value="CASE">Case</SelectItem>
            <SelectItem value="PAYOUT">Payout</SelectItem>
            <SelectItem value="PAYMENT">Payment</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={fetchEntries}>
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No journal entries found.</p>
          ) : (
            <div className={SCROLLBAR_CLASSES}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Entity</TableHead>
                    <TableHead className="text-xs">Description</TableHead>
                    <TableHead className="text-xs text-right">Debit</TableHead>
                    <TableHead className="text-xs text-right">Credit</TableHead>
                    <TableHead className="text-xs text-center">Balanced</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => {
                    const isExpanded = expandedRows.has(entry.id);
                    const totalDebit = entry.lines.filter((l) => l.entryType === 'DEBIT').reduce((s, l) => s + l.amount, 0);
                    const totalCredit = entry.lines.filter((l) => l.entryType === 'CREDIT').reduce((s, l) => s + l.amount, 0);
                    return (
                      <>
                        <TableRow
                          key={entry.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => toggleRow(entry.id)}
                        >
                          <TableCell className="p-2">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDateTime(entry.entryDate)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {entry.entryType}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{entry.entityName || entry.entityType}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate" title={entry.description}>
                            {entry.description}
                          </TableCell>
                          <TableCell className={`text-xs text-right font-medium ${totalDebit > 0 ? 'text-amber-700' : 'text-muted-foreground'}`}>
                            {totalDebit > 0 ? formatNaira(totalDebit) : '—'}
                          </TableCell>
                          <TableCell className={`text-xs text-right font-medium ${totalCredit > 0 ? 'text-emerald-700' : 'text-muted-foreground'}`}>
                            {totalCredit > 0 ? formatNaira(totalCredit) : '—'}
                          </TableCell>
                          <TableCell className="text-center">
                            {entry.balanced ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-500 mx-auto" />
                            )}
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow key={`${entry.id}-lines`}>
                            <TableCell colSpan={8} className="bg-muted/30 p-4">
                              <div className="ml-8 space-y-1">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                  Journal Lines
                                </p>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="text-[10px]">Account</TableHead>
                                      <TableHead className="text-[10px]">Type</TableHead>
                                      <TableHead className="text-[10px] text-right">Amount</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {entry.lines.map((line) => (
                                      <TableRow key={line.id}>
                                        <TableCell className="text-xs font-mono">{line.accountName}</TableCell>
                                        <TableCell>
                                          <Badge
                                            variant="outline"
                                            className={`text-[10px] ${
                                              line.entryType === 'DEBIT'
                                                ? 'border-amber-300 text-amber-700'
                                                : 'border-emerald-300 text-emerald-700'
                                            }`}
                                          >
                                            {line.entryType}
                                          </Badge>
                                        </TableCell>
                                        <TableCell
                                          className={`text-xs text-right font-medium ${
                                            line.entryType === 'DEBIT' ? 'text-amber-700' : 'text-emerald-700'
                                          }`}
                                        >
                                          {formatNaira(line.amount)}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="p-4">
            <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 3 — Payouts
// ═══════════════════════════════════════════════════════════════════════════

function PayoutsTab() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [actingId, setActingId] = useState<string | null>(null);

  const fetchPayouts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '20',
      });
      const res = await authFetch(`/api/admin/payouts?${params}`);
      if (!res.ok) throw new Error('Failed to fetch payouts');
      const data: PaginatedResponse<Payout> & { statusCounts?: Record<string, number> } = await res.json();
      setPayouts(data.data);
      setTotalPages(data.totalPages);
      if (data.statusCounts) setStatusCounts(data.statusCounts);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load payouts');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchPayouts();
  }, [fetchPayouts]);

  const handleAction = async (payoutId: string, action: 'release' | 'retry') => {
    setActingId(payoutId);
    try {
      const res = await authFetch('/api/admin/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payoutId, action }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to ${action} payout`);
      }
      toast.success(`Payout ${action === 'release' ? 'released' : 'retry queued'} successfully`);
      fetchPayouts();
    } catch (err: any) {
      toast.error(err.message || `Failed to ${action} payout`);
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status Summary Badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium">Status:</span>
        {Object.entries(PAYOUT_STATUS_STYLES).map(([status, style]) => (
          <Badge
            key={status}
            variant="outline"
            className={`text-[10px] ${style}`}
          >
            {status.replace(/_/g, ' ')}: {statusCounts[status] ?? 0}
          </Badge>
        ))}
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 ml-auto" onClick={fetchPayouts}>
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
      </div>

      {/* Payouts Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : payouts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No payouts found.</p>
          ) : (
            <div className={SCROLLBAR_CLASSES}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Agent</TableHead>
                    <TableHead className="text-xs text-right">Amount</TableHead>
                    <TableHead className="text-xs text-right">Fee</TableHead>
                    <TableHead className="text-xs text-right">Net</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs font-mono">Paystack Ref</TableHead>
                    <TableHead className="text-xs text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payouts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(p.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs font-medium">{p.agentName}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{formatNaira(p.amount)}</TableCell>
                      <TableCell className="text-xs text-right font-mono text-muted-foreground">{formatNaira(p.fee)}</TableCell>
                      <TableCell className="text-xs text-right font-semibold">{formatNaira(p.netAmount)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${PAYOUT_STATUS_STYLES[p.status] || ''}`}>
                          {p.status.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {p.paystackReference ? (
                          <span className="flex items-center gap-1">
                            <Eye className="w-3 h-3" />
                            {p.paystackReference.length > 12
                              ? `${p.paystackReference.slice(0, 12)}...`
                              : p.paystackReference}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {p.status === 'REQUESTED' && (
                            <Button
                              size="sm"
                              className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                              disabled={actingId === p.id}
                              onClick={() => handleAction(p.id, 'release')}
                            >
                              {actingId === p.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Send className="w-3 h-3" />
                              )}
                              Release
                            </Button>
                          )}
                          {p.status === 'FAILED' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                              disabled={actingId === p.id}
                              onClick={() => handleAction(p.id, 'retry')}
                            >
                              {actingId === p.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3 h-3" />
                              )}
                              Retry
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="p-4">
            <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 4 — Finance Exceptions
// ═══════════════════════════════════════════════════════════════════════════

function ExceptionsTab() {
  const [exceptions, setExceptions] = useState<FinanceException[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [resolvedFilter, setResolvedFilter] = useState<string>('ALL');
  const [unresolvedBySeverity, setUnresolvedBySeverity] = useState<Record<string, number>>({});

  // Resolve dialog state
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<FinanceException | null>(null);
  const [resolveNote, setResolveNote] = useState('');
  const [resolving, setResolving] = useState(false);

  const fetchExceptions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '20',
      });
      if (severityFilter !== 'ALL') params.set('severity', severityFilter);
      if (resolvedFilter !== 'ALL') params.set('resolved', resolvedFilter);
      const res = await authFetch(`/api/admin/finance/exceptions?${params}`);
      if (!res.ok) throw new Error('Failed to fetch exceptions');
      const data: PaginatedResponse<FinanceException> & { unresolvedBySeverity?: Record<string, number> } =
        await res.json();
      setExceptions(data.data);
      setTotalPages(data.totalPages);
      if (data.unresolvedBySeverity) setUnresolvedBySeverity(data.unresolvedBySeverity);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load exceptions');
    } finally {
      setLoading(false);
    }
  }, [page, severityFilter, resolvedFilter]);

  useEffect(() => {
    fetchExceptions();
  }, [fetchExceptions]);

  const openResolveDialog = (exc: FinanceException) => {
    setResolveTarget(exc);
    setResolveNote('');
    setResolveDialogOpen(true);
  };

  const handleResolve = async () => {
    if (!resolveTarget || !resolveNote.trim()) return;
    setResolving(true);
    try {
      const res = await authFetch('/api/admin/finance/exceptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exceptionId: resolveTarget.id,
          action: 'resolve',
          resolutionNote: resolveNote.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to resolve exception');
      }
      toast.success('Exception resolved');
      setResolveDialogOpen(false);
      fetchExceptions();
    } catch (err: any) {
      toast.error(err.message || 'Failed to resolve exception');
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Unresolved Counts by Severity */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium">Unresolved:</span>
        {Object.entries(EXCEPTION_SEVERITY_STYLES).map(([sev, style]) => (
          <Badge key={sev} variant="outline" className={`text-[10px] ${style}`}>
            {sev}: {unresolvedBySeverity[sev] ?? 0}
          </Badge>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <Select value={severityFilter} onValueChange={(v) => { setSeverityFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[150px] h-8 text-xs">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Severities</SelectItem>
            <SelectItem value="LOW">Low</SelectItem>
            <SelectItem value="MEDIUM">Medium</SelectItem>
            <SelectItem value="HIGH">High</SelectItem>
            <SelectItem value="CRITICAL">Critical</SelectItem>
          </SelectContent>
        </Select>
        <Select value={resolvedFilter} onValueChange={(v) => { setResolvedFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[150px] h-8 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All</SelectItem>
            <SelectItem value="UNRESOLVED">Unresolved</SelectItem>
            <SelectItem value="RESOLVED">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={fetchExceptions}>
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
      </div>

      {/* Exceptions Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : exceptions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No exceptions found.</p>
          ) : (
            <div className={SCROLLBAR_CLASSES}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Severity</TableHead>
                    <TableHead className="text-xs">Entity</TableHead>
                    <TableHead className="text-xs">Description</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exceptions.map((exc) => (
                    <TableRow key={exc.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(exc.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {exc.type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${EXCEPTION_SEVERITY_STYLES[exc.severity] || ''}`}
                        >
                          {exc.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{exc.entityName || exc.entityType}</TableCell>
                      <TableCell
                        className="text-xs max-w-[200px] truncate"
                        title={exc.description}
                      >
                        {exc.description}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${EXCEPTION_STATUS_STYLES[exc.status] || ''}`}
                        >
                          {exc.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {exc.status === 'OPEN' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                            onClick={() => openResolveDialog(exc)}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            Resolve
                          </Button>
                        )}
                        {exc.status !== 'OPEN' && exc.resolutionNote && (
                          <span
                            className="text-[10px] text-muted-foreground max-w-[120px] truncate inline-block"
                            title={exc.resolutionNote}
                          >
                            {exc.resolutionNote}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="p-4">
            <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </CardContent>
      </Card>

      {/* Resolve Dialog */}
      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resolve Exception</DialogTitle>
            <DialogDescription>
              {resolveTarget && (
                <>
                  <span className="font-mono text-xs">{resolveTarget.type}</span>{' — '}
                  <span className="text-xs">{resolveTarget.description}</span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="resolve-note" className="text-sm">
                Resolution Note <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="resolve-note"
                placeholder="Describe how this exception was resolved..."
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                rows={3}
                className="text-sm resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setResolveDialogOpen(false)}
              disabled={resolving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={resolving || !resolveNote.trim()}
              onClick={handleResolve}
            >
              {resolving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN — Finance Dashboard
// ═══════════════════════════════════════════════════════════════════════════

export function FinanceDashboard() {
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);

  const fetchOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const res = await authFetch('/api/admin/finance');
      if (!res.ok) throw new Error('Failed to fetch finance overview');
      const data = await res.json();
      setOverview(data);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load finance overview');
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  return (
    <div className="space-y-6">
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full justify-start h-10">
          <TabsTrigger value="overview" className="text-xs gap-1.5">
            <Wallet className="w-3.5 h-3.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="journal" className="text-xs gap-1.5">
            <ScrollText className="w-3.5 h-3.5" /> Journal
          </TabsTrigger>
          <TabsTrigger value="payouts" className="text-xs gap-1.5">
            <Banknote className="w-3.5 h-3.5" /> Payouts
          </TabsTrigger>
          <TabsTrigger value="exceptions" className="text-xs gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Exceptions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab overview={overview} loading={overviewLoading} />
        </TabsContent>

        <TabsContent value="journal" className="mt-4">
          <JournalEntriesTab />
        </TabsContent>

        <TabsContent value="payouts" className="mt-4">
          <PayoutsTab />
        </TabsContent>

        <TabsContent value="exceptions" className="mt-4">
          <ExceptionsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default FinanceDashboard;
