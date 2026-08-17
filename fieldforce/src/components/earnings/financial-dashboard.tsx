'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle,
  ArrowUpRight,
  ShieldCheck,
  Banknote,
} from 'lucide-react';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';

import { useAppStore } from '@/lib/store';
import { fetchWalletSummary, fetchEarnings, requestPayout as requestPayoutApi } from '@/lib/asoju-api';
import type { PayoutStatus } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

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

// ─── Chart Config ───────────────────────────────────────────────────────

const chartConfig = {
  earnings: {
    label: 'Earnings',
    color: 'var(--color-green-500)',
  },
};

// ─── Component ───────────────────────────────────────────────────────────

export function FinancialDashboard() {
  const { agent, payouts, walletSummary, setWalletSummary, setPayouts } = useAppStore();

  const [payoutDialogOpen, setPayoutDialogOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [requesting, setRequesting] = useState(false);

  // Fetch wallet summary
  const loadWalletSummary = useCallback(async () => {
    try {
      const data = await fetchWalletSummary();
      setWalletSummary(data);
    } catch {
      // Silently handle
    }
  }, [setWalletSummary]);

  // Fetch earnings (payouts)
  const loadEarnings = useCallback(async () => {
    try {
      const data = await fetchEarnings();
      setPayouts(data.payouts);
    } catch {
      // Silently handle
    }
  }, [setPayouts]);

  useEffect(() => {
    loadWalletSummary();
    loadEarnings();
  }, [loadWalletSummary, loadEarnings]);

  // Use wallet summary from store (v4.0 wallet model)
  const availableBalance = walletSummary?.availableBalance ?? agent?.currentBalance ?? 0;
  const pendingBalance = walletSummary?.pendingBalance ?? 0;
  const qcClearedBalance = walletSummary?.qcClearedBalance ?? 0;
  const totalEarnings = walletSummary?.totalEarnings ?? agent?.totalEarnings ?? 0;

  // ── Monthly chart data (last 6 months) ────────────────────────────────

  const monthlyData = useMemo(() => {
    const now = new Date();
    const months: { month: string; earnings: number }[] = [];

    for (let i = 5; i >= 0; i--) {
      const ref = subMonths(now, i);
      const start = startOfMonth(ref);
      const end = endOfMonth(ref);
      const label = format(ref, 'MMM');

      const earned = payouts
        .filter((p) => {
          const d = parseISO(p.requestedAt);
          return (
            (p.status === 'PAID') &&
            isWithinInterval(d, { start, end })
          );
        })
        .reduce((sum, p) => sum + p.netAmount, 0);

      months.push({ month: label, earnings: earned });
    }

    return months;
  }, [payouts]);

  // ── Earnings trend (compare last 2 months) ────────────────────────────

  const trend = useMemo(() => {
    if (monthlyData.length < 2) return null;
    const last = monthlyData[monthlyData.length - 1].earnings;
    const prev = monthlyData[monthlyData.length - 2].earnings;
    if (prev === 0) return last > 0 ? 100 : null;
    return Math.round(((last - prev) / prev) * 100);
  }, [monthlyData]);

  // ── Payout request handler ─────────────────────────────────────────────

  const handleRequestPayout = async () => {
    const num = Number(payoutAmount);
    if (!num || num <= 0 || num > availableBalance) return;

    setRequesting(true);
    try {
      await requestPayoutApi({ amount: num });
      setPayoutAmount('');
      setPayoutDialogOpen(false);
      // Refresh data
      await loadWalletSummary();
      await loadEarnings();
    } catch {
      // Error could be shown as toast
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-6">
      {/* ── Balance Card ──────────────────────────────────────────────── */}
      <Card className="border-green-200 bg-gradient-to-br from-green-600 to-green-700 text-white shadow-lg">
        <CardContent className="flex flex-col items-center gap-3 pt-2">
          <div className="flex items-center gap-2 text-green-100">
            <Wallet className="size-5" />
            <span className="text-sm font-medium">Available Balance</span>
          </div>
          <span className="text-4xl font-bold tracking-tight">
            {formatNaira(availableBalance)}
          </span>
          <div className="mt-1 flex items-center gap-1.5">
            {trend !== null && trend !== 0 && (
              <span
                className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  trend > 0
                    ? 'bg-green-500/30 text-green-100'
                    : 'bg-red-500/30 text-red-100'
                }`}
              >
                {trend > 0 ? (
                  <TrendingUp className="size-3" />
                ) : (
                  <TrendingDown className="size-3" />
                )}
                {Math.abs(trend)}%
              </span>
            )}
            {trend === 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold text-green-100">
                Flat
              </span>
            )}
            <span className="text-xs text-green-200">vs last month</span>
          </div>
        </CardContent>
      </Card>

      {/* ── Wallet Summary: 4 Buckets ────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="py-4">
          <CardContent className="flex flex-col items-center gap-1.5 px-3">
            <div className="flex items-center gap-1">
              <Clock className="size-3.5 text-amber-500" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Pending</span>
            </div>
            <span className="text-xl font-bold text-amber-600">
              {formatNaira(pendingBalance)}
            </span>
            <span className="text-[10px] text-muted-foreground">Awaiting QC</span>
          </CardContent>
        </Card>

        <Card className="py-4">
          <CardContent className="flex flex-col items-center gap-1.5 px-3">
            <div className="flex items-center gap-1">
              <ShieldCheck className="size-3.5 text-sky-500" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">QC Cleared</span>
            </div>
            <span className="text-xl font-bold text-sky-600">
              {formatNaira(qcClearedBalance)}
            </span>
            <span className="text-[10px] text-muted-foreground">Passed review</span>
          </CardContent>
        </Card>

        <Card className="py-4">
          <CardContent className="flex flex-col items-center gap-1.5 px-3">
            <div className="flex items-center gap-1">
              <Banknote className="size-3.5 text-green-500" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Available</span>
            </div>
            <span className="text-xl font-bold text-green-600">
              {formatNaira(availableBalance)}
            </span>
            <span className="text-[10px] text-muted-foreground">For withdrawal</span>
          </CardContent>
        </Card>

        <Card className="py-4">
          <CardContent className="flex flex-col items-center gap-1.5 px-3">
            <div className="flex items-center gap-1">
              <TrendingUp className="size-3.5 text-emerald-500" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Lifetime</span>
            </div>
            <span className="text-xl font-bold text-emerald-600">
              {formatNaira(totalEarnings)}
            </span>
            <span className="text-[10px] text-muted-foreground">Total earned</span>
          </CardContent>
        </Card>
      </div>

      {/* ── Request Payout Button ──────────────────────────────────────── */}
      <Dialog open={payoutDialogOpen} onOpenChange={setPayoutDialogOpen}>
        <DialogTrigger asChild>
          <Button
            size="lg"
            className="w-full bg-green-600 text-base font-semibold hover:bg-green-700"
            disabled={availableBalance < 1000}
          >
            <ArrowUpRight className="size-5" />
            Request Payout
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Payout</DialogTitle>
            <DialogDescription>
              Enter the amount you want to withdraw to your bank account.
              Minimum: ₦1,000 · Available: {formatNaira(availableBalance)}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="payout-amount">Amount (₦)</Label>
              <Input
                id="payout-amount"
                type="number"
                placeholder="Enter amount"
                min={1000}
                max={availableBalance}
                value={payoutAmount}
                onChange={(e) => setPayoutAmount(e.target.value)}
              />
              {Number(payoutAmount) > availableBalance && (
                <p className="text-xs text-red-600">
                  Amount exceeds available balance
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPayoutDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={handleRequestPayout}
              disabled={
                !payoutAmount ||
                Number(payoutAmount) < 1000 ||
                Number(payoutAmount) > availableBalance ||
                requesting
              }
            >
              {requesting ? 'Processing...' : `Withdraw ${payoutAmount ? formatNaira(Number(payoutAmount)) : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Monthly Earnings Chart ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly Earnings</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[200px] w-full">
            <BarChart data={monthlyData}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                tickFormatter={(v: number) =>
                  v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                }
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => formatNaira(Number(value))}
                  />
                }
              />
              <Bar
                dataKey="earnings"
                fill="var(--color-earnings)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
