// ─── /api/customer/cases/[id]/quotes ────────────────────────────────
// GET: List quotes for a case (customer can see amounts and status)
// POST: Accept a quote (changes quote status to ACCEPTED)

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
      select: { customerId: true },
    });

    if (!caseData || caseData.customerId !== auth.customerId) {
      return NextResponse.json(
        { error: 'Case not found' },
        { status: 404 }
      );
    }

    const quotes = await db.quote.findMany({
      where: { caseId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        asojuFee: true,
        breakdown: true,
        validityDays: true,
        status: true,
        expiresAt: true,
        acceptedAt: true,
        rejectedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      data: quotes.map((q) => ({
        ...q,
        // Customer-safe: do not expose agentPayout
        statusLabel: q.status,
      })),
    });
  } catch (error) {
    console.error('GET /api/customer/cases/[id]/quotes error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch quotes' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await getCustomerAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    const body = await request.json();
    const { quoteId, action } = body;

    if (!quoteId || action !== 'accept') {
      return NextResponse.json(
        { error: 'quoteId and action=accept are required' },
        { status: 400 }
      );
    }

    // BOLA/IDOR: verify case belongs to this customer
    const caseData = await db.case.findUnique({
      where: { id },
      select: { customerId: true, status: true, quoteAmount: true },
    });

    if (!caseData || caseData.customerId !== auth.customerId) {
      return NextResponse.json(
        { error: 'Case not found' },
        { status: 404 }
      );
    }

    // Verify the quote belongs to this case and is PENDING
    const quote = await db.quote.findUnique({
      where: { id: quoteId },
    });

    if (!quote || quote.caseId !== id) {
      return NextResponse.json(
        { error: 'Quote not found' },
        { status: 404 }
      );
    }

    if (quote.status !== 'PENDING') {
      return NextResponse.json(
        { error: `Quote is already ${quote.status.toLowerCase()}` },
        { status: 409 }
      );
    }

    // Check if expired
    if (quote.expiresAt && new Date() > quote.expiresAt) {
      await db.quote.update({
        where: { id: quoteId },
        data: { status: 'EXPIRED' },
      });
      return NextResponse.json(
        { error: 'Quote has expired' },
        { status: 409 }
      );
    }

    // Accept the quote in a transaction
    await db.$transaction([
      db.quote.update({
        where: { id: quoteId },
        data: {
          status: 'ACCEPTED',
          acceptedAt: new Date(),
        },
      }),
      db.case.update({
        where: { id },
        data: {
          status: 'PAYMENT_PENDING',
          quoteAmount: quote.amount,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      message: 'Quote accepted. Please proceed with payment.',
    });
  } catch (error) {
    console.error('POST /api/customer/cases/[id]/quotes error:', error);
    return NextResponse.json(
      { error: 'Failed to accept quote' },
      { status: 500 }
    );
  }
}
