// ─── GET /api/customer/cases/[id]/payments ───────────────────────────
// Payments for a specific case (BOLA/IDOR protected).

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCustomerAuth, mapPaymentStatus } from '@/lib/customer-auth';

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
      select: { customerId: true, quoteAmount: true, paymentStatus: true },
    });

    if (!caseData || caseData.customerId !== auth.customerId) {
      return NextResponse.json(
        { error: 'Case not found' },
        { status: 404 }
      );
    }

    const payments = await db.customerPayment.findMany({
      where: { caseId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        method: true,
        status: true,
        reference: true,
        paidAt: true,
        createdAt: true,
      },
    });

    // Compute total paid
    const totalPaid = payments
      .filter((p) => p.status === 'VERIFIED')
      .reduce((sum, p) => sum + p.amount, 0);

    return NextResponse.json({
      caseId: id,
      quoteAmount: caseData.quoteAmount,
      totalPaid,
      paymentStatus: caseData.paymentStatus,
      paymentStatusLabel: mapPaymentStatus(caseData.paymentStatus),
      payments: payments.map((p) => ({
        ...p,
        statusLabel: mapPaymentStatus(p.status),
      })),
    });
  } catch (error) {
    console.error('GET /api/customer/cases/[id]/payments error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch payments' },
      { status: 500 }
    );
  }
}
