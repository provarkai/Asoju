// ═══════════════════════════════════════════════════════════════════════════════
// Admin SOS Alert Management
// GET  — List alerts (active first, then history)
// POST — Acknowledge, resolve, or escalate alerts
// ═══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  acknowledgeSosAlert,
  resolveSosAlert,
  escalateSosAlert,
  ESCALATION_CHANNELS,
  EscalationChannel,
} from '@/lib/sos-protocol';

// ─── GET: List SOS Alerts ────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const agentId = searchParams.get('agentId') || undefined;

    // Build the where clause
    const where: Record<string, unknown> = {};
    if (status) {
      where.status = status;
    } else {
      // Default: active statuses first
      where.status = { in: ['ACTIVE', 'ACKNOWLEDGED', 'ESCALATED'] };
    }
    if (agentId) {
      where.agentId = agentId;
    }

    const { db } = await import('@/lib/db');

    const alerts = await db.sosAlert.findMany({
      where,
      include: {
        agent: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
            phone: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: {
        // Active/escalated first, then by creation time desc
        createdAt: 'desc',
      },
      take: 50,
    });

    // If no status filter was provided, also fetch recent history
    let history: typeof alerts = [];
    if (!status) {
      const historyWhere: Record<string, unknown> = {
        status: { in: ['RESOLVED', 'FALSE_ALARM'] },
      };
      if (agentId) {
        historyWhere.agentId = agentId;
      }

      history = await db.sosAlert.findMany({
        where: historyWhere,
        include: {
          agent: {
            select: {
              id: true,
              displayName: true,
              firstName: true,
              lastName: true,
              phone: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
    }

    const formatAlert = (alert: (typeof alerts)[number]) => ({
      id: alert.id,
      agentId: alert.agentId,
      missionId: alert.missionId,
      caseId: alert.caseId,
      alertType: alert.alertType,
      severity: alert.severity,
      message: alert.message,
      latitude: alert.latitude,
      longitude: alert.longitude,
      accuracy: alert.accuracy,
      address: alert.address,
      status: alert.status,
      acknowledgedBy: alert.acknowledgedBy,
      acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
      resolvedBy: alert.resolvedBy,
      resolvedAt: alert.resolvedAt?.toISOString() ?? null,
      resolutionNotes: alert.resolutionNotes,
      escalationLevel: alert.escalationLevel,
      escalatedChannels: alert.escalatedChannels,
      emergencyContacts: alert.emergencyContacts,
      audioUrl: alert.audioUrl,
      photoUrls: alert.photoUrls,
      evidenceLocked: alert.evidenceLocked,
      createdAt: alert.createdAt.toISOString(),
      updatedAt: alert.updatedAt.toISOString(),
      agentName: alert.agent?.displayName ||
        `${alert.agent?.firstName || ''} ${alert.agent?.lastName || ''}`.trim() ||
        'Unknown Agent',
      agentPhone: alert.agent?.phone || null,
    });

    return NextResponse.json({
      alerts: alerts.map(formatAlert),
      history: history.map(formatAlert),
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN SOS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST: SOS Actions ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);

    const body = await request.json();
    const { action } = body;

    if (!action || !['acknowledge', 'resolve', 'escalate'].includes(action)) {
      return NextResponse.json(
        { error: 'Action must be acknowledge, resolve, or escalate' },
        { status: 400 },
      );
    }

    // ── Acknowledge Alert ───────────────────────────────────────────────────
    if (action === 'acknowledge') {
      const { alertId, adminId } = body;
      if (!alertId) {
        return NextResponse.json({ error: 'alertId is required' }, { status: 400 });
      }
      const alert = await acknowledgeSosAlert(alertId, adminId || admin.adminId);
      return NextResponse.json({ message: 'Alert acknowledged', alert });
    }

    // ── Resolve Alert ───────────────────────────────────────────────────────
    if (action === 'resolve') {
      const { alertId, adminId, resolutionNotes } = body;
      if (!alertId) {
        return NextResponse.json({ error: 'alertId is required' }, { status: 400 });
      }
      if (!resolutionNotes) {
        return NextResponse.json({ error: 'resolutionNotes is required' }, { status: 400 });
      }
      const alert = await resolveSosAlert(alertId, adminId || admin.adminId, resolutionNotes);
      return NextResponse.json({ message: 'Alert resolved', alert });
    }

    // ── Escalate Alert ──────────────────────────────────────────────────────
    if (action === 'escalate') {
      const { alertId, channel } = body;
      if (!alertId) {
        return NextResponse.json({ error: 'alertId is required' }, { status: 400 });
      }
      if (!channel) {
        return NextResponse.json(
          { error: `channel is required. Valid: ${ESCALATION_CHANNELS.join(', ')}` },
          { status: 400 },
        );
      }
      if (!(ESCALATION_CHANNELS as readonly string[]).includes(channel)) {
        return NextResponse.json(
          { error: `Invalid channel: ${channel}. Valid: ${ESCALATION_CHANNELS.join(', ')}` },
          { status: 400 },
        );
      }
      const alert = await escalateSosAlert(alertId, channel as EscalationChannel);
      return NextResponse.json({ message: `Alert escalated via ${channel}`, alert });
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN SOS] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
