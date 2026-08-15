// ─── GET /api/customer/cases/[id]/timeline ─────────────────────────────
// Customer-visible timeline events only (isCustomerVisible=true).

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCustomerAuth } from '@/lib/customer-auth';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await getCustomerAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    // BOLA/IDOR: verify case belongs to this customer
    const caseData = await db.case.findUnique({
      where: { id },
      select: { customerId: true },
    });

    if (!caseData || caseData.customerId !== auth.customerId) {
      return NextResponse.json(
        { error: 'Case not found' },
        { status: 404 }
      );
    }

    const events = await db.caseTimelineEvent.findMany({
      where: {
        caseId: id,
        isCustomerVisible: true,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        eventType: true,
        title: true,
        description: true,
        actorType: true,
        actorName: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ data: events });
  } catch (error) {
    console.error('GET /api/customer/cases/[id]/timeline error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch timeline' },
      { status: 500 }
    );
  }
}
