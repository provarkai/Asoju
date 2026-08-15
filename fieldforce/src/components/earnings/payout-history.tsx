'use client';

import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Download, Inbox } from 'lucide-react';

import { useAppStore } from '@/lib/store';
import type { PayoutRecord, PayoutStatus } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString()}`;
}

const STATUS_STYLES: Record<PayoutStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
  QC_CLEARED: 'bg-sky-100 text-sky-800 border-sky-200',
  APPROVED: 'bg-violet-100 text-violet-800 border-violet-200',
  PROCESSING: 'bg-sky-100 text-sky-800 border-sky-200',
  PAID: 'bg-green-100 text-green-800 border-green-200',
  FAILED: 'bg-red-100 text-red-800 border-red-200',
  RECONCILIATION: 'bg-gray-100 text-gray-800 border-gray-200',
};

const STATUS_LABELS: Record<PayoutStatus, string> = {
  PENDING: 'Pending',
  QC_CLEARED: 'QC Cleared',
  APPROVED: 'Approved',
  PROCESSING: 'Processing',
  PAID: 'Paid',
  FAILED: 'Failed',
  RECONCILIATION: 'Reconciliation',
};

// ─── Filter Tabs ──────────────────────────────────────────────────────────

type FilterTab = 'ALL' | PayoutStatus;

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'PROCESSING', label: 'Processing' },
  { id: 'PAID', label: 'Paid' },
  { id: 'FAILED', label: 'Failed' },
];

// ─── Single Payout Card ──────────────────────────────────────────────────

function PayoutItem({ record }: { record: PayoutRecord }) {
  const dateStr = format(parseISO(record.requestedAt), 'd MMM yyyy');
  const paidDateStr = record.paidAt
    ? format(parseISO(record.paidAt), 'd MMM yyyy')
    : null;

  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-3 px-4">
        {/* Top row: title + status */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {record.missionTitle ?? 'Mission Payout'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {dateStr}
              {paidDateStr && (
                <span className="ml-2 text-green-600">
                  Paid {paidDateStr}
                </span>
              )}
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn('text-[10px] font-semibold', STATUS_STYLES[record.status])}
          >
            {STATUS_LABELS[record.status]}
          </Badge>
        </div>

        {/* Amounts breakdown */}
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 px-3 py-2 text-center">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Gross
            </p>
            <p className="text-sm font-semibold text-foreground">
              {formatNaira(record.amount)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              ASOJU Fee
            </p>
            <p className="text-sm font-semibold text-red-600">
              -{formatNaira(record.asojuFee)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Net
            </p>
            <p className="text-lg font-bold text-green-700">
              {formatNaira(record.netAmount)}
            </p>
          </div>
        </div>

        {/* Bottom row: reference + download */}
        <div className="flex items-center justify-between">
          {record.paystackReference ? (
            <span className="truncate text-[11px] text-muted-foreground">
              Ref: {record.paystackReference}
            </span>
          ) : (
            <span />
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-muted-foreground"
          >
            <Download className="size-3" />
            Download Receipt
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Payout History List ─────────────────────────────────────────────────

export function PayoutHistory() {
  const payouts = useAppStore((s) => s.payouts);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('ALL');

  const sorted = useMemo(
    () => [...payouts].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
    [payouts]
  );

  const filtered = useMemo(
    () => activeFilter === 'ALL' ? sorted : sorted.filter((p) => p.status === activeFilter),
    [sorted, activeFilter]
  );

  if (payouts.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12">
          <div className="flex size-14 items-center justify-center rounded-full bg-muted">
            <Inbox className="size-7 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">
            No payouts yet
          </p>
          <p className="max-w-[240px] text-center text-xs text-muted-foreground">
            Once you complete missions and request payouts, your transaction history
            will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Payout History</CardTitle>
        </CardHeader>
      </Card>

      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto scrollbar-none">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveFilter(tab.id)}
            className={cn(
              'shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border',
              activeFilter === tab.id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:bg-muted'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {filtered.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">No payouts match this filter.</p>
          </div>
        ) : (
          filtered.map((record) => (
            <PayoutItem key={record.id} record={record} />
          ))
        )}
      </div>
    </div>
  );
}
