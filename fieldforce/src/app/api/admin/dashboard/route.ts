import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';

// ─── GET: Command Center KPIs ─────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Run all queries in parallel for speed
    const [
      totalCustomers,
      activeCases,
      openCases,
      completedTodayCases,
      casesByStatus,
      casesByServiceType,
      totalRevenue,
      pendingPayments,
      recentActivity,
      slaAtRiskCases,
      activeMissions,
    ] = await Promise.all([
      // Total customers
      db.customer.count({ where: { status: 'ACTIVE' } }),

      // Active cases (not completed, not cancelled, not failed)
      db.case.count({
        where: {
          status: { notIn: ['COMPLETED', 'CANCELLED', 'FAILED'] },
        },
      }),

      // Open cases
      db.case.count({ where: { status: 'OPEN' } }),

      // Completed today
      db.case.count({
        where: {
          status: 'COMPLETED',
          completedAt: { gte: startOfToday },
        },
      }),

      // Cases by status breakdown
      db.case.groupBy({
        by: ['status'],
        _count: { id: true },
      }),

      // Cases by service type breakdown
      db.case.groupBy({
        by: ['serviceCode'],
        _count: { id: true },
      }),

      // Total revenue (verified payments)
      db.customerPayment.aggregate({
        _sum: { amount: true },
        where: { status: 'VERIFIED' },
      }),

      // Pending payments
      db.customerPayment.aggregate({
        _sum: { amount: true },
        where: { status: 'PENDING' },
      }),

      // Recent activity (last 10 timeline events)
      db.caseTimelineEvent.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          eventType: true,
          title: true,
          actorType: true,
          actorName: true,
          createdAt: true,
          case: {
            select: {
              caseNumber: true,
              title: true,
            },
          },
        },
      }),

      // SLA at-risk cases (deadline within 24h and not completed)
      db.case.findMany({
        where: {
          slaDeadline: { lte: twentyFourHoursFromNow, gte: now },
          status: { notIn: ['COMPLETED', 'CANCELLED', 'FAILED'] },
        },
        select: {
          id: true,
          caseNumber: true,
          title: true,
          status: true,
          priority: true,
          slaDeadline: true,
          customer: { select: { name: true } },
        },
        take: 20,
        orderBy: { slaDeadline: 'asc' },
      }),

      // Active missions (missionState is set and not COMPLETED/FAILED/CANCELLED)
      db.case.count({
        where: {
          missionState: { not: null },
        },
      }),
    ]);

    return NextResponse.json({
      kpis: {
        totalCustomers,
        activeCases,
        openCases,
        completedToday: completedTodayCases,
        activeMissions,
        totalRevenue: totalRevenue._sum.amount || 0,
        pendingPayments: pendingPayments._sum.amount || 0,
      },
      casesByStatus: casesByStatus.map((s) => ({
        status: s.status,
        count: s._count.id,
      })),
      casesByServiceType: casesByServiceType.map((s) => ({
        serviceCode: s.serviceCode,
        count: s._count.id,
      })),
      recentActivity: recentActivity.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
      })),
      slaAtRiskCases: slaAtRiskCases.map((c) => ({
        ...c,
        slaDeadline: c.slaDeadline?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN DASHBOARD] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
