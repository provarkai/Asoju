'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Send,
  Clock,
  Loader2,
  RotateCcw,
  Trash2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ArrowUpDown,
  Inbox,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
} from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { authFetch } from '@/lib/auth-fetch';
import { formatDateTime } from './admin-types';

// ─── Types ──────────────────────────────────────────────────────────────

interface OutboxMetrics {
  pending: number;
  processing: number;
  delivered: number;
  failed: number;
  deadLetter: number;
  oldestPendingAgeMs: number | null;
  queueDepth: number;
}

interface OutboxMessage {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion: string;
  source: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  targetType: string;
  targetUrl: string | null;
  correlationId: string | null;
  createdAt: string;
  deliveredAt: string | null;
  deadLetteredAt: string | null;
}

interface OutboxResponse {
  messages: OutboxMessage[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
  metrics: OutboxMetrics;
}

// ─── Status Config ──────────────────────────────────────────────────────

const STATUS_OPTIONS = ['ALL', 'PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD_LETTER'] as const;

type StatusFilter = (typeof STATUS_OPTIONS)[number];

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
  PROCESSING: 'bg-sky-100 text-sky-800 border-sky-200',
  DELIVERED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  FAILED: 'bg-red-100 text-red-800 border-red-200',
  DEAD_LETTER: 'bg-rose-100 text-rose-800 border-rose-200',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  PENDING: <Clock className="size-3" />,
  PROCESSING: <Loader2 className="size-3 animate-spin" />,
  DELIVERED: <CheckCircle className="size-3" />,
  FAILED: <XCircle className="size-3" />,
  DEAD_LETTER: <AlertTriangle className="size-3" />,
};

// ─── Component ──────────────────────────────────────────────────────────

export function OutboxPanel() {
  const [data, setData] = useState<OutboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [page, setPage] = useState(1);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = 20;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (statusFilter !== 'ALL') {
        params.set('status', statusFilter);
      }
      const res = await authFetch(`/api/admin/outbox?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load outbox data');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleReplay = async (messageId: string) => {
    setReplayingId(messageId);
    try {
      const res = await authFetch('/api/admin/outbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'replay', messageId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Replay failed');
      }
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Replay failed');
    } finally {
      setReplayingId(null);
    }
  };

  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const res = await authFetch('/api/admin/outbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cleanup' }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Cleanup failed');
      }
      const result = await res.json();
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cleanup failed');
    } finally {
      setCleaning(false);
    }
  };

  const handleStatusChange = (value: string) => {
    setStatusFilter(value as StatusFilter);
    setPage(1);
  };

  // ─── Metric Cards ─────────────────────────────────────────────────────

  const metricCards = data ? [
    { label: 'Pending', value: data.metrics.pending, icon: <Clock className="size-5 text-amber-600" />, color: 'border-amber-200 bg-amber-50' },
    { label: 'Processing', value: data.metrics.processing, icon: <Loader2 className="size-5 text-sky-600" />, color: 'border-sky-200 bg-sky-50' },
    { label: 'Delivered', value: data.metrics.delivered, icon: <CheckCircle className="size-5 text-emerald-600" />, color: 'border-emerald-200 bg-emerald-50' },
    { label: 'Failed', value: data.metrics.failed, icon: <XCircle className="size-5 text-red-600" />, color: 'border-red-200 bg-red-50' },
    { label: 'Dead Letter', value: data.metrics.deadLetter, icon: <AlertTriangle className="size-5 text-rose-600" />, color: 'border-rose-200 bg-rose-50' },
  ] : [];

  // ─── Pagination helpers ───────────────────────────────────────────────

  const renderPagination = () => {
    if (!data || data.pagination.pages <= 1) return null;

    const { pages, page: current } = data.pagination;
    const items: React.ReactNode[] = [];

    items.push(
      <PaginationItem key="prev">
        <PaginationPrevious
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className={current === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
        />
      </PaginationItem>
    );

    // Show first page
    items.push(
      <PaginationItem key={1}>
        <PaginationLink
          isActive={current === 1}
          onClick={() => setPage(1)}
          className="cursor-pointer"
        >
          1
        </PaginationLink>
      </PaginationItem>
    );

    // Ellipsis before
    if (current > 3) {
      items.push(
        <PaginationItem key="ellipsis-start">
          <PaginationEllipsis />
        </PaginationItem>
      );
    }

    // Pages around current
    const start = Math.max(2, current - 1);
    const end = Math.min(pages - 1, current + 1);
    for (let i = start; i <= end; i++) {
      items.push(
        <PaginationItem key={i}>
          <PaginationLink
            isActive={current === i}
            onClick={() => setPage(i)}
            className="cursor-pointer"
          >
            {i}
          </PaginationLink>
        </PaginationItem>
      );
    }

    // Ellipsis after
    if (current < pages - 2) {
      items.push(
        <PaginationItem key="ellipsis-end">
          <PaginationEllipsis />
        </PaginationItem>
      );
    }

    // Show last page
    if (pages > 1) {
      items.push(
        <PaginationItem key={pages}>
          <PaginationLink
            isActive={current === pages}
            onClick={() => setPage(pages)}
            className="cursor-pointer"
          >
            {pages}
          </PaginationLink>
        </PaginationItem>
      );
    }

    items.push(
      <PaginationItem key="next">
        <PaginationNext
          onClick={() => setPage((p) => Math.min(pages, p + 1))}
          className={current === pages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
        />
      </PaginationItem>
    );

    return (
      <Pagination className="mt-4">
        <PaginationContent>{items}</PaginationContent>
      </Pagination>
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Send className="size-5" />
          <h2 className="text-lg font-semibold">Event Outbox</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCleanup}
          disabled={cleaning}
        >
          {cleaning ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
          Cleanup Old Messages
        </Button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="size-4 shrink-0" />
          <span>{error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-red-700 hover:bg-red-100"
            onClick={() => setError(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Metric Cards */}
      {loading && !data ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {metricCards.map((m) => (
            <Card key={m.label} className={`border ${m.color}`}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/70">
                  {m.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{m.label}</p>
                  <p className="text-xl font-bold">{m.value.toLocaleString()}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-44">
            <ArrowUpDown className="size-4" />
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'ALL' ? 'All Statuses' : s.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {data && (
          <span className="text-sm text-muted-foreground">
            {data.pagination.total.toLocaleString()} messages
          </span>
        )}
      </div>

      {/* Messages Table */}
      <Card>
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : data && data.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <Inbox className="size-10" />
              <p className="text-sm">No outbox messages found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Event Type</TableHead>
                  <TableHead>Aggregate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Attempts</TableHead>
                  <TableHead className="hidden md:table-cell">Target</TableHead>
                  <TableHead className="hidden lg:table-cell">Created</TableHead>
                  <TableHead className="hidden lg:table-cell">Last Error</TableHead>
                  <TableHead className="pr-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.messages.map((msg) => (
                  <TableRow key={msg.id}>
                    <TableCell className="pl-4">
                      <span className="font-mono text-xs font-medium">
                        {msg.eventType}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {msg.aggregateType}
                        <span className="ml-1 font-mono text-xs">
                          {msg.aggregateId.slice(0, 8)}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={STATUS_STYLES[msg.status] ?? ''}
                      >
                        {STATUS_ICONS[msg.status]}
                        {msg.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm">
                        {msg.attempts}/{msg.maxAttempts}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="text-sm text-muted-foreground">
                        {msg.targetType || '—'}
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <span className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatDateTime(msg.createdAt)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden max-w-48 truncate lg:table-cell">
                      <span className="text-xs text-red-600" title={msg.lastError ?? undefined}>
                        {msg.lastError ? (msg.lastError.length > 60 ? msg.lastError.slice(0, 60) + '…' : msg.lastError) : '—'}
                      </span>
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      {msg.status === 'DEAD_LETTER' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleReplay(msg.id)}
                          disabled={replayingId === msg.id}
                        >
                          {replayingId === msg.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="size-3.5" />
                          )}
                          Replay
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {renderPagination()}
    </div>
  );
}
