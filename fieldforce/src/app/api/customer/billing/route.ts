// ─── GET /api/customer/billing ───────────────────────────────────────
// Billing history: all payments across all cases for the authenticated customer.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCustomerAuth, mapPaymentStatus } from '@/lib/customer-auth';

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
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20')));

    const [payments, total] = await Promise.all([
      db.customerPayment.findMany({
        where: { customerId: auth.customerId },
        include: {
          case: {
            select: {
              id: true,
              caseNumber: true,
              title: true,
              serviceCode: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.customerPayment.count({
        where: { customerId: auth.customerId },
      }),
    ]);

    // Compute aggregate totals
    const [totalPaid, totalPending] = await Promise.all([
      db.customerPayment.aggregate({
        where: { customerId: auth.customerId, status: 'VERIFIED' },
        _sum: { amount: true },
      }),
      db.customerPayment.aggregate({
        where: { customerId: auth.customerId, status: 'PENDING' },
        _sum: { amount: true },
      }),
    ]);

    return NextResponse.json({
      summary: {
        totalPaid: totalPaid._sum.amount || 0,
        totalPending: totalPending._sum.amount || 0,
        totalTransactions: total,
      },
      data: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        method: p.method,
        status: p.status,
        statusLabel: mapPaymentStatus(p.status),
        reference: p.reference,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
        case: p.case
          ? {
              id: p.case.id,
              caseNumber: p.case.caseNumber,
              title: p.case.title,
              serviceCode: p.case.serviceCode,
            }
          : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('GET /api/customer/billing error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch billing history' },
      { status: 500 }
    );
  }
}
