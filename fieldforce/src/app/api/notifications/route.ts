// ═══════════════════════════════════════════════════════════════════════════════
// Admin WhatsApp Notifications
// GET  — List notifications with stats
// POST — Send a notification or process pending queue
// ═══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  sendWhatsAppMessage,
  processPendingNotifications,
  getNotificationStats,
  NotificationEntityType,
  RecipientRole,
  WhatsAppMediaType,
} from '@/lib/whatsapp-gateway';

// ─── GET: List Notifications with Stats ──────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const entityType = searchParams.get('entityType') || undefined;
    const entityId = searchParams.get('entityId') || undefined;
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));

    // Build where clause
    const where: Record<string, unknown> = {};
    if (status) {
      where.status = status;
    }
    if (entityType) {
      where.entityType = entityType;
    }
    if (entityId) {
      where.entityId = entityId;
    }

    const { db } = await import('@/lib/db');

    const [notifications, stats] = await Promise.all([
      db.whatsAppNotification.findMany({
        where,
        select: {
          id: true,
          recipientPhone: true,
          recipientName: true,
          recipientRole: true,
          templateId: true,
          templateParams: true,
          messageText: true,
          mediaUrl: true,
          mediaType: true,
          entityType: true,
          entityId: true,
          caseId: true,
          status: true,
          retryCount: true,
          maxRetries: true,
          errorCode: true,
          errorMessage: true,
          sentAt: true,
          deliveredAt: true,
          failedAt: true,
          whatsappMessageId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      getNotificationStats(),
    ]);

    return NextResponse.json({
      notifications: notifications.map((n) => ({
        ...n,
        sentAt: n.sentAt?.toISOString() ?? null,
        deliveredAt: n.deliveredAt?.toISOString() ?? null,
        failedAt: n.failedAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      stats,
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[NOTIFICATIONS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST: Send or Process Notifications ─────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);

    const body = await request.json();
    const { action } = body;

    if (!action || !['send', 'process_pending'].includes(action)) {
      return NextResponse.json(
        { error: 'Action must be send or process_pending' },
        { status: 400 },
      );
    }

    // ── Send Notification ───────────────────────────────────────────────────
    if (action === 'send') {
      const {
        recipientPhone,
        recipientName,
        recipientRole,
        templateId,
        templateParams,
        messageText,
        mediaUrl,
        mediaType,
        entityType,
        entityId,
        caseId,
      } = body;

      if (!recipientPhone) {
        return NextResponse.json(
          { error: 'recipientPhone is required' },
          { status: 400 },
        );
      }

      // Validate recipient role
      const validRoles: string[] = ['CUSTOMER', 'BENEFICIARY', 'ADMIN', 'AGENT'];
      if (recipientRole && !validRoles.includes(recipientRole)) {
        return NextResponse.json(
          { error: `Invalid recipientRole. Valid: ${validRoles.join(', ')}` },
          { status: 400 },
        );
      }

      // Validate entity type
      const validEntityTypes: string[] = ['MISSION', 'CASE', 'CARE_VISIT', 'SOS', 'REPORT', 'CARE_PLAN'];
      if (entityType && !validEntityTypes.includes(entityType)) {
        return NextResponse.json(
          { error: `Invalid entityType. Valid: ${validEntityTypes.join(', ')}` },
          { status: 400 },
        );
      }

      // Validate media type
      const validMediaTypes: string[] = ['IMAGE', 'DOCUMENT', 'VIDEO', 'AUDIO'];
      if (mediaType && !validMediaTypes.includes(mediaType)) {
        return NextResponse.json(
          { error: `Invalid mediaType. Valid: ${validMediaTypes.join(', ')}` },
          { status: 400 },
        );
      }

      const notification = await sendWhatsAppMessage({
        recipientPhone,
        recipientName: recipientName || undefined,
        recipientRole: (recipientRole as RecipientRole) || 'CUSTOMER',
        templateId: templateId || undefined,
        templateParams: templateParams || undefined,
        messageText: messageText || undefined,
        mediaUrl: mediaUrl || undefined,
        mediaType: (mediaType as WhatsAppMediaType) || undefined,
        entityType: (entityType as NotificationEntityType) || undefined,
        entityId: entityId || undefined,
        caseId: caseId || undefined,
      });

      return NextResponse.json({
        message: 'Notification queued',
        notification: {
          id: notification.id,
          status: notification.status,
          recipientPhone: notification.recipientPhone,
          createdAt: notification.createdAt.toISOString(),
        },
      });
    }

    // ── Process Pending Queue ───────────────────────────────────────────────
    if (action === 'process_pending') {
      const { limit } = body;
      const batchSize = Math.min(50, Math.max(1, parseInt(limit || '20', 10)));
      const result = await processPendingNotifications(batchSize);

      return NextResponse.json({
        message: `Processed ${result.processed} notifications`,
        ...result,
      });
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[NOTIFICATIONS] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
