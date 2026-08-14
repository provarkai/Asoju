import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';

// ─── GET: Operations Summary ────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const now = new Date();
    const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const [
      activeMissions,
      slaAtRiskCount,
      escalatedCount,
      qcPendingCount,
      recentAuditEvents,
    ] = await Promise.all([
      // Active field missions (cases in active mission states)
      db.case.findMany({
        where: {
          missionState: { in: ['ACCEPTED', 'EN_ROUTE', 'ON_SITE', 'EXECUTING'] },
        },
        select: {
          id: true,
          caseNumber: true,
          title: true,
          status: true,
          priority: true,
          missionState: true,
          assignedAgentName: true,
          slaDeadline: true,
          address: true,
          lga: true,
          state: true,
          executingSince: true,
          customer: {
            select: { name: true },
          },
        },
        orderBy: { priority: 'desc' },
      }),

      // SLA at-risk count
      db.case.count({
        where: {
          slaDeadline: { lte: twentyFourHoursFromNow, gte: now },
          status: { notIn: ['COMPLETED', 'CANCELLED', 'FAILED'] },
        },
      }),

      // Escalated cases (HIGH or CRITICAL priority, active)
      db.case.count({
        where: {
          priority: { in: ['HIGH', 'CRITICAL'] },
          status: { notIn: ['COMPLETED', 'CANCELLED', 'FAILED'] },
        },
      }),

      // QC pending review
      db.case.count({
        where: {
          qcStatus: 'PENDING',
          status: { notIn: ['COMPLETED', 'CANCELLED', 'FAILED'] },
        },
      }),

      // Recent audit events
      db.adminAuditEvent.findMany({
        take: 15,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          actorType: true,
          action: true,
          entityType: true,
          entityId: true,
          metadata: true,
          createdAt: true,
          adminUser: {
            select: { displayName: true, email: true },
          },
        },
      }),
    ]);

    return NextResponse.json({
      summary: {
        activeMissionsCount: activeMissions.length,
        slaAtRiskCount,
        escalatedCount,
        qcPendingCount,
      },
      activeMissions: activeMissions.map((m) => ({
        ...m,
        slaDeadline: m.slaDeadline?.toISOString() ?? null,
        executingSince: m.executingSince?.toISOString() ?? null,
      })),
      recentAuditEvents: recentAuditEvents.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN OPERATIONS] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
