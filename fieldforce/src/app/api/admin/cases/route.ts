import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/admin-auth';

// ─── GET: List Cases ───────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const priority = searchParams.get('priority') || '';
    const serviceCode = searchParams.get('serviceCode') || '';
    const paymentStatus = searchParams.get('paymentStatus') || '';
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortOrder = searchParams.get('sortOrder') || 'desc';

    // Build where clause
    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { caseNumber: { contains: search } },
        { title: { contains: search } },
        { customer: { name: { contains: search } } },
      ];
    }
    if (status) {
      where.status = status;
    }
    if (priority) {
      where.priority = priority;
    }
    if (serviceCode) {
      where.serviceCode = serviceCode;
    }
    if (paymentStatus) {
      where.paymentStatus = paymentStatus;
    }

    // Build orderBy
    const orderByMap: Record<string, string> = {
      createdAt: 'createdAt',
      caseNumber: 'caseNumber',
      priority: 'priority',
      status: 'status',
      slaDeadline: 'slaDeadline',
      quoteAmount: 'quoteAmount',
    };
    const orderByField = orderByMap[sortBy] || 'createdAt';
    const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

    const [cases, total] = await Promise.all([
      db.case.findMany({
        where,
        select: {
          id: true,
          caseNumber: true,
          title: true,
          serviceCode: true,
          status: true,
          priority: true,
          quoteAmount: true,
          paymentStatus: true,
          missionState: true,
          assignedAgentName: true,
          slaDeadline: true,
          createdAt: true,
          completedAt: true,
          customer: {
            select: { id: true, name: true, type: true },
          },
        },
        orderBy: { [orderByField]: orderDirection },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.case.count({ where }),
    ]);

    // Get service code labels from ServiceDefinition
    const serviceCodes = [...new Set(cases.map((c) => c.serviceCode))];
    const serviceDefs = serviceCodes.length > 0
      ? await db.serviceDefinition.findMany({
          where: { code: { in: serviceCodes } },
          select: { code: true, label: true },
        })
      : [];
    const serviceLabelMap = new Map(serviceDefs.map((s) => [s.code, s.label]));

    return NextResponse.json({
      cases: cases.map((c) => ({
        ...c,
        serviceLabel: serviceLabelMap.get(c.serviceCode) || c.serviceCode,
        slaDeadline: c.slaDeadline?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
        completedAt: c.completedAt?.toISOString() ?? null,
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
    console.error('[ADMIN CASES] List error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
