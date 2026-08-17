// ─── GET /api/customer/cases ────────────────────────────────────────
// List cases for the authenticated customer, sorted by createdAt desc.
// Includes customer-safe projections: missionState mapped to plain language,
// no internal agent details exposed.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCustomerAuth, mapMissionState, mapCaseStatus, mapPaymentStatus, mapPriority } from '@/lib/customer-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await getCustomerAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20')));

    const where: Record<string, unknown> = { customerId: auth.customerId };
    if (status) {
      where.status = status;
    }

    const [cases, total] = await Promise.all([
      db.case.findMany({
        where,
        select: {
          id: true,
          caseNumber: true,
          title: true,
          status: true,
          serviceCode: true,
          priority: true,
          paymentStatus: true,
          missionState: true,
          assignedAgentName: true,
          slaDeadline: true,
          createdAt: true,
          completedAt: true,
          cancelledAt: true,
          quotes: {
            select: {
              amount: true,
              status: true,
            },
            where: { status: 'ACCEPTED' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.case.count({ where }),
    ]);

    const data = cases.map((c) => ({
      id: c.id,
      caseNumber: c.caseNumber,
      title: c.title,
      status: c.status,
      statusLabel: mapCaseStatus(c.status),
      serviceCode: c.serviceCode,
      priority: c.priority,
      priorityLabel: mapPriority(c.priority),
      paymentStatus: c.paymentStatus,
      paymentStatusLabel: mapPaymentStatus(c.paymentStatus),
      missionState: mapMissionState(c.missionState),
      assignedAgentName: c.assignedAgentName || null,
      approvedQuoteAmount: c.quotes[0]?.amount || null,
      slaDeadline: c.slaDeadline,
      createdAt: c.createdAt,
      completedAt: c.completedAt,
      cancelledAt: c.cancelledAt,
    }));

    return NextResponse.json({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('GET /api/customer/cases error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch cases' },
      { status: 500 }
    );
  }
}
