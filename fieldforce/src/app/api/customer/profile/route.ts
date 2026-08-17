// ─── GET /api/customer/profile ────────────────────────────────────────
// Returns the authenticated customer's organization info + current member info.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCustomerAuth } from '@/lib/customer-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await getCustomerAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }

    const member = await db.customerMember.findUnique({
      where: { id: auth.memberId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        phone: true,
        avatarUrl: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            address: true,
            city: true,
            state: true,
            country: true,
            logoUrl: true,
            type: true,
            status: true,
            primaryContact: true,
            createdAt: true,
          },
        },
      },
    });

    if (!member) {
      return NextResponse.json(
        { error: 'Member not found' },
        { status: 404 }
      );
    }

    // Count related records
    const [requestCount, caseCount, paymentCount] = await Promise.all([
      db.serviceRequest.count({ where: { customerId: auth.customerId } }),
      db.case.count({ where: { customerId: auth.customerId } }),
      db.customerPayment.count({ where: { customerId: auth.customerId } }),
    ]);

    return NextResponse.json({
      member,
      stats: {
        totalRequests: requestCount,
        totalCases: caseCount,
        totalPayments: paymentCount,
      },
    });
  } catch (error) {
    console.error('GET /api/customer/profile error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch profile' },
      { status: 500 }
    );
  }
}
