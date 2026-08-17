import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';

// ─── GET: Case Timeline Events ──────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
    const { id } = await params;

    // Verify case exists
    const caseExists = await db.case.findUnique({
      where: { id },
      select: { id: true, caseNumber: true },
    });
    if (!caseExists) {
      return NextResponse.json(
        { error: 'Case not found' },
        { status: 404 }
      );
    }

    const events = await db.caseTimelineEvent.findMany({
      where: { caseId: id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      caseNumber: caseExists.caseNumber,
      events: events.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN CASE TIMELINE] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ─── POST: Add Timeline Event ───────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin(request);
    const { id } = await params;
    const body = await request.json();
    const { eventType, title, description, isCustomerVisible } = body;

    if (!eventType || !title) {
      return NextResponse.json(
        { error: 'eventType and title are required' },
        { status: 400 }
      );
    }

    // Verify case exists
    const caseExists = await db.case.findUnique({
      where: { id },
      select: { id: true, caseNumber: true },
    });
    if (!caseExists) {
      return NextResponse.json(
        { error: 'Case not found' },
        { status: 404 }
      );
    }

    const event = await db.caseTimelineEvent.create({
      data: {
        caseId: id,
        eventType,
        title,
        description: description || null,
        actorType: 'ADMIN',
        actorName: admin.email,
        isCustomerVisible: isCustomerVisible !== false,
      },
    });

    // Audit event
    await db.adminAuditEvent.create({
      data: {
        adminUserId: admin.adminId,
        actorType: 'ADMIN',
        action: 'TIMELINE_EVENT_ADDED',
        entityType: 'CaseTimelineEvent',
        entityId: event.id,
        metadata: JSON.stringify({
          caseNumber: caseExists.caseNumber,
          eventType,
          title,
        }),
      },
    });

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN CASE TIMELINE] Create error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
