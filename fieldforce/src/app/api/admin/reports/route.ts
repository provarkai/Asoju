// ═══════════════════════════════════════════════════════════════════════════════
// Admin Service Reports
// GET  — List reports or get report for a case
// POST — Generate, deliver, or retry report delivery
// ═══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { db } from '@/lib/db';
import {
  generateServiceReport,
  deliverServiceReport,
  getReportForCase,
  DeliveryChannel,
} from '@/lib/service-report';

// ─── GET: List Reports or Get Report by Case ─────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const caseId = searchParams.get('caseId');
    const status = searchParams.get('status') || undefined;
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));

    // Get report for a specific case
    if (caseId) {
      const report = await getReportForCase(caseId);
      if (!report) {
        return NextResponse.json({ error: 'No report found for this case' }, { status: 404 });
      }

      // Enrich with case and agent info
      const mission = await db.mission.findUnique({
        where: { id: report.missionId },
        select: {
          case: { select: { title: true } },
          agent: { select: { displayName: true, firstName: true, lastName: true } },
        },
      });

      return NextResponse.json({
        report: {
          ...report,
          caseTitle: mission?.case?.title || null,
        },
      });
    }

    // List recent reports with pagination
    const where: Record<string, unknown> = {};
    if (status) {
      where.deliveryStatus = status;
    }

    const [reports, total] = await Promise.all([
      db.serviceReport.findMany({
        where,
        select: {
          id: true,
          missionId: true,
          caseId: true,
          title: true,
          outcome: true,
          agentName: true,
          agentTier: true,
          trustBadge: true,
          deliveryStatus: true,
          deliveryChannel: true,
          deliveredAt: true,
          createdAt: true,
          case: {
            select: { title: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      db.serviceReport.count({ where }),
    ]);

    return NextResponse.json({
      reports: reports.map((r) => ({
        ...r,
        caseTitle: r.case?.title || null,
        case: undefined,
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN REPORTS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST: Generate, Deliver, or Retry Report ─────────────────────────────

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);

    const body = await request.json();
    const { action } = body;

    if (!action || !['generate', 'deliver', 'retry_delivery'].includes(action)) {
      return NextResponse.json(
        { error: 'Action must be generate, deliver, or retry_delivery' },
        { status: 400 },
      );
    }

    // ── Generate Report ────────────────────────────────────────────────────
    if (action === 'generate') {
      const { missionId } = body;
      if (!missionId) {
        return NextResponse.json(
          { error: 'missionId is required' },
          { status: 400 },
        );
      }

      const report = await generateServiceReport(missionId);
      return NextResponse.json({
        message: 'Service report generated',
        report,
      });
    }

    // ── Deliver Report ─────────────────────────────────────────────────────
    if (action === 'deliver') {
      const { reportId, channel } = body;
      if (!reportId || !channel) {
        return NextResponse.json(
          { error: 'reportId and channel are required' },
          { status: 400 },
        );
      }

      const validChannels: string[] = ['WHATSAPP', 'SMS', 'EMAIL', 'IN_APP'];
      if (!validChannels.includes(channel)) {
        return NextResponse.json(
          { error: `Invalid channel. Must be one of: ${validChannels.join(', ')}` },
          { status: 400 },
        );
      }

      const report = await deliverServiceReport(reportId, channel as DeliveryChannel);
      return NextResponse.json({
        message: `Report marked as delivered via ${channel}`,
        report,
      });
    }

    // ── Retry Failed Delivery ──────────────────────────────────────────────
    if (action === 'retry_delivery') {
      const { reportId } = body;
      if (!reportId) {
        return NextResponse.json(
          { error: 'reportId is required' },
          { status: 400 },
        );
      }

      // Check current status
      const existing = await db.serviceReport.findUnique({
        where: { id: reportId },
      });
      if (!existing) {
        return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      }
      if (existing.deliveryStatus !== 'FAILED') {
        return NextResponse.json(
          { error: `Cannot retry delivery in status: ${existing.deliveryStatus}. Only FAILED reports can be retried.` },
          { status: 400 },
        );
      }

      // Reset to PENDING for re-delivery
      const report = await db.serviceReport.update({
        where: { id: reportId },
        data: {
          deliveryStatus: 'PENDING',
          deliveredAt: null,
          deliveryId: null,
        },
      });

      return NextResponse.json({
        message: 'Report delivery reset to PENDING for retry',
        report,
      });
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN REPORTS] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
