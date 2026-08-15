import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';

// ─── GET: Audit Log ────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const action = searchParams.get('action') || '';
    const entityType = searchParams.get('entityType') || '';

    // Build where clause
    const where: Record<string, unknown> = {};

    if (action) {
      where.action = action;
    }
    if (entityType) {
      where.entityType = entityType;
    }

    const [events, total] = await Promise.all([
      db.adminAuditEvent.findMany({
        where,
        select: {
          id: true,
          actorType: true,
          action: true,
          entityType: true,
          entityId: true,
          metadata: true,
          correlationId: true,
          createdAt: true,
          adminUser: {
            select: {
              id: true,
              displayName: true,
              email: true,
              role: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.adminAuditEvent.count({ where }),
    ]);

    return NextResponse.json({
      events: events.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN AUDIT] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
