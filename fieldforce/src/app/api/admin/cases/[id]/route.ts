import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';

// ─── GET: Full Case Detail ───────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
    const { id } = await params;

    const caseDetail = await db.case.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            type: true,
          },
        },
        serviceRequest: {
          select: {
            id: true,
            description: true,
            urgency: true,
            specialInstructions: true,
            attachments: true,
            member: {
              select: { displayName: true, email: true },
            },
          },
        },
        timeline: {
          orderBy: { createdAt: 'desc' },
        },
        quotes: {
          orderBy: { createdAt: 'desc' },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!caseDetail) {
      return NextResponse.json(
        { error: 'Case not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ...caseDetail,
      slaDeadline: caseDetail.slaDeadline?.toISOString() ?? null,
      slaStartedAt: caseDetail.slaStartedAt?.toISOString() ?? null,
      slaCompletedAt: caseDetail.slaCompletedAt?.toISOString() ?? null,
      assignedAt: caseDetail.assignedAt?.toISOString() ?? null,
      executingSince: caseDetail.executingSince?.toISOString() ?? null,
      submittedAt: caseDetail.submittedAt?.toISOString() ?? null,
      completedAt: caseDetail.completedAt?.toISOString() ?? null,
      cancelledAt: caseDetail.cancelledAt?.toISOString() ?? null,
      createdAt: caseDetail.createdAt.toISOString(),
      updatedAt: caseDetail.updatedAt.toISOString(),
      timeline: caseDetail.timeline.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
      })),
      quotes: caseDetail.quotes.map((q) => ({
        ...q,
        expiresAt: q.expiresAt?.toISOString() ?? null,
        acceptedAt: q.acceptedAt?.toISOString() ?? null,
        rejectedAt: q.rejectedAt?.toISOString() ?? null,
        createdAt: q.createdAt.toISOString(),
      })),
      payments: caseDetail.payments.map((p) => ({
        ...p,
        paidAt: p.paidAt?.toISOString() ?? null,
        verifiedAt: p.verifiedAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      })),
      messages: caseDetail.messages.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN CASE DETAIL] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ─── PATCH: Update Case ─────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(request);
    const { id } = await params;
    const body = await request.json();

    const existing = await db.case.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: 'Case not found' },
        { status: 404 }
      );
    }

    const {
      status, priority, quoteAmount, agentPayout, asojuFee,
      paymentStatus, paymentMethod, qcStatus, cancelReason,
    } = body;

    const updateData: Record<string, unknown> = {};

    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (quoteAmount !== undefined) updateData.quoteAmount = Number(quoteAmount);
    if (agentPayout !== undefined) updateData.agentPayout = Number(agentPayout);
    if (asojuFee !== undefined) updateData.asojuFee = Number(asojuFee);
    if (paymentStatus !== undefined) updateData.paymentStatus = paymentStatus;
    if (paymentMethod !== undefined) updateData.paymentMethod = paymentMethod;
    if (qcStatus !== undefined) updateData.qcStatus = qcStatus;
    if (cancelReason !== undefined) updateData.cancelReason = cancelReason;

    // Auto-set timestamps on certain transitions
    if (status === 'COMPLETED' && !existing.completedAt) {
      updateData.completedAt = new Date();
      updateData.slaCompletedAt = new Date();
    }
    if (status === 'CANCELLED' && !existing.cancelledAt) {
      updateData.cancelledAt = new Date();
    }

    const updated = await db.case.update({
      where: { id },
      data: updateData,
    });

    // Audit event
    await db.adminAuditEvent.create({
      data: {
        adminUserId: admin.adminId,
        actorType: 'ADMIN',
        action: 'CASE_UPDATED',
        entityType: 'Case',
        entityId: id,
        metadata: JSON.stringify({
          caseNumber: existing.caseNumber,
          changes: Object.keys(updateData),
        }),
      },
    });

    // Optionally create timeline event for status changes
    if (status && status !== existing.status) {
      await db.caseTimelineEvent.create({
        data: {
          caseId: id,
          eventType: statusToEventType(status),
          title: `Case status changed to ${status}`,
          actorType: 'ADMIN',
          actorName: admin.email,
        },
      });
    }

    return NextResponse.json({ case: updated });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN CASE UPDATE] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function statusToEventType(status: string): string {
  const map: Record<string, string> = {
    QUOTED: 'QUOTE_GENERATED',
    PAYMENT_PENDING: 'PAYMENT_RECEIVED',
    ACCEPTED: 'QUOTE_ACCEPTED',
    IN_PROGRESS: 'MISSION_ASSIGNED',
    UNDER_REVIEW: 'UNDER_REVIEW',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    FAILED: 'CANCELLED',
  };
  return map[status] || 'UNDER_REVIEW';
}
