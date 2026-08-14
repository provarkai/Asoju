// ─── /api/admin/finance/exceptions ─────────────────────────────────────
// P0.8: Admin finance exceptions API — view and resolve financial anomalies
// Requires FINANCE or SUPER_ADMIN role

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminAuth, withSecurityHeaders } from '@/lib/bola';

// ─── GET /api/admin/finance/exceptions ────────────────────────────────
// List finance exceptions with filters

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminAuth(request, ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS']);
    if (admin instanceof NextResponse) return admin;

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const severity = url.searchParams.get('severity');
    const type = url.searchParams.get('type');
    const resolved = url.searchParams.get('resolved');

    const skip = (page - 1) * limit;

    const where: any = {};
    if (severity) where.severity = severity;
    if (type) where.type = type;
    if (resolved === 'true') where.resolvedAt = { not: null };
    else if (resolved === 'false') where.resolvedAt = null;

    const [exceptions, total] = await Promise.all([
      db.financeException.findMany({
        where,
        orderBy: resolved === 'false' ? { createdAt: 'asc' } : { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.financeException.count({ where }),
    ]);

    const severityCounts = await db.financeException.groupBy({
      where: { resolvedAt: null },
      by: ['severity'],
      _count: { id: true },
    });

    const response = NextResponse.json({
      exceptions: exceptions.map((e) => ({
        id: e.id,
        type: e.type,
        severity: e.severity,
        entityType: e.entityType,
        entityId: e.entityId,
        description: e.description,
        metadata: e.metadata ? JSON.parse(e.metadata) : null,
        resolvedAt: e.resolvedAt?.toISOString() || null,
        resolvedBy: e.resolvedBy,
        resolution: e.resolution,
        createdAt: e.createdAt.toISOString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      unresolvedBySeverity: Object.fromEntries(
        severityCounts.map((g) => [g.severity, g._count.id])
      ),
    });

    return withSecurityHeaders(response);

  } catch (error) {
    console.error('GET /api/admin/finance/exceptions error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch finance exceptions' },
      { status: 500 }
    );
  }
}

// ─── POST /api/admin/finance/exceptions ────────────────────────────────
// Resolve a finance exception

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminAuth(request, ['SUPER_ADMIN', 'FINANCE']);
    if (admin instanceof NextResponse) return admin;

    const { exceptionId, resolution } = await request.json();

    if (!exceptionId || !resolution) {
      return NextResponse.json(
        { error: 'exceptionId and resolution are required' },
        { status: 400 }
      );
    }

    const exception = await db.financeException.findUnique({
      where: { id: exceptionId },
    });

    if (!exception) {
      return NextResponse.json(
        { error: 'Exception not found' },
        { status: 404 }
      );
    }

    if (exception.resolvedAt) {
      return NextResponse.json(
        { error: 'Exception already resolved' },
        { status: 409 }
      );
    }

    const updated = await db.financeException.update({
      where: { id: exceptionId },
      data: {
        resolvedAt: new Date(),
        resolvedBy: admin.adminId,
        resolution,
      },
    });

    await db.adminAuditEvent.create({
      data: {
        adminUserId: admin.adminId,
        actorType: 'ADMIN',
        action: 'FINANCE_EXCEPTION_RESOLVED',
        entityType: 'FinanceException',
        entityId: exceptionId,
        metadata: JSON.stringify({
          exceptionType: exception.type,
          severity: exception.severity,
          resolution,
        }),
      },
    });

    const response = NextResponse.json(updated);
    return withSecurityHeaders(response);

  } catch (error) {
    console.error('POST /api/admin/finance/exceptions error:', error);
    return NextResponse.json(
      { error: 'Failed to resolve exception' },
      { status: 500 }
    );
  }
}
