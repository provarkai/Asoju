import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';

// ─── GET: Analytics Data ───────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const [
      casesByStatus,
      casesByServiceType,
      allCases,
      allPayments,
    ] = await Promise.all([
      // Cases by status
      db.case.groupBy({
        by: ['status'],
        _count: { id: true },
      }),

      // Cases by service type
      db.case.groupBy({
        by: ['serviceCode'],
        _count: { id: true },
      }),

      // All cases for completion rate and SLA performance
      db.case.findMany({
        select: {
          status: true,
          createdAt: true,
          slaStartedAt: true,
          slaCompletedAt: true,
          slaDeadline: true,
          completedAt: true,
        },
      }),

      // All verified payments for revenue by month
      db.customerPayment.findMany({
        where: { status: 'VERIFIED' },
        select: {
          amount: true,
          paidAt: true,
          createdAt: true,
        },
      }),
    ]);

    // ── Cases by status (for chart) ──
    const statusData = casesByStatus.map((s) => ({
      status: s.status,
      count: s._count.id,
    }));

    // ── Revenue by month (last 6 months) ──
    const revenueByMonth = getRevenueByMonth(allPayments, 6);

    // ── Cases by service type ──
    const serviceTypeData = casesByServiceType.map((s) => ({
      serviceCode: s.serviceCode,
      count: s._count.id,
    }));

    // ── Completion rate trend ──
    const completionTrend = getCompletionTrend(allCases, 6);

    // ── Average SLA performance ──
    const slaPerformance = getSlaPerformance(allCases);

    return NextResponse.json({
      casesByStatus: statusData,
      revenueByMonth,
      casesByServiceType: serviceTypeData,
      completionRateTrend: completionTrend,
      slaPerformance,
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN ANALYTICS] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function getRevenueByMonth(
  payments: { amount: number; paidAt: Date | null; createdAt: Date }[],
  months: number
) {
  const now = new Date();
  const result: { month: string; revenue: number }[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
    const monthLabel = monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

    const total = payments
      .filter((p) => {
        const d = p.paidAt || p.createdAt;
        return d >= monthStart && d <= monthEnd;
      })
      .reduce((sum, p) => sum + p.amount, 0);

    result.push({ month: monthLabel, revenue: total });
  }

  return result;
}

function getCompletionTrend(
  cases: {
    status: string;
    createdAt: Date;
    completedAt: Date | null;
  }[],
  months: number
) {
  const now = new Date();
  const result: { month: string; total: number; completed: number; rate: number }[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
    const monthLabel = monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

    const monthCases = cases.filter(
      (c) => c.createdAt >= monthStart && c.createdAt <= monthEnd
    );
    const completed = monthCases.filter((c) => c.status === 'COMPLETED').length;
    const total = monthCases.length;

    result.push({
      month: monthLabel,
      total,
      completed,
      rate: total > 0 ? Math.round((completed / total) * 100) : 0,
    });
  }

  return result;
}

function getSlaPerformance(cases: {
  slaStartedAt: Date | null;
  slaCompletedAt: Date | null;
  slaDeadline: Date | null;
  completedAt: Date | null;
  status: string;
}[]) {
  const completedCases = cases.filter(
    (c) =>
      c.status === 'COMPLETED' &&
      c.slaDeadline &&
      c.completedAt
  );

  if (completedCases.length === 0) {
    return {
      avgDurationHours: 0,
      onTimeRate: 0,
      totalCompleted: 0,
      breachedCount: 0,
    };
  }

  let totalDurationMs = 0;
  let breachedCount = 0;

  for (const c of completedCases) {
    const start = c.slaStartedAt || c.completedAt!;
    const end = c.completedAt!;
    totalDurationMs += end.getTime() - start.getTime();

    if (end > c.slaDeadline!) {
      breachedCount++;
    }
  }

  const avgDurationHours = Math.round(
    (totalDurationMs / completedCases.length) / (1000 * 60 * 60)
  );
  const onTimeRate = Math.round(
    ((completedCases.length - breachedCount) / completedCases.length) * 100
  );

  return {
    avgDurationHours,
    onTimeRate,
    totalCompleted: completedCases.length,
    breachedCount,
  };
}