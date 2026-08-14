// ─── GET /api/customer/cases/[id] ─────────────────────────────────────
// Case detail with BOLA/IDOR check.
// Customer-safe: no internal notes, agent personal details, or QC internals.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  getCustomerAuth,
  mapMissionState,
  mapCaseStatus,
  mapPaymentStatus,
  mapPriority,
} from '@/lib/customer-auth';

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
      include: {
        timeline: {
          where: { isCustomerVisible: true },
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
        },
        quotes: {
          select: {
            id: true,
            amount: true,
            asojuFee: true,
            breakdown: true,
            validityDays: true,
            status: true,
            expiresAt: true,
            acceptedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        payments: {
          select: {
            id: true,
            amount: true,
            method: true,
            status: true,
            paidAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!caseData || caseData.customerId !== auth.customerId) {
      return NextResponse.json(
        { error: 'Case not found' },
        { status: 404 }
      );
    }

    // Payment summary
    const totalPaid = caseData.payments
      .filter((p) => p.status === 'VERIFIED')
      .reduce((sum, p) => sum + p.amount, 0);

    const approvedQuote = caseData.quotes.find((q) => q.status === 'ACCEPTED');
    const pendingQuote = caseData.quotes.find((q) => q.status === 'PENDING');

    return NextResponse.json({
      id: caseData.id,
      caseNumber: caseData.caseNumber,
      title: caseData.title,
      description: caseData.description,
      serviceCode: caseData.serviceCode,
      status: caseData.status,
      statusLabel: mapCaseStatus(caseData.status),
      priority: caseData.priority,
      priorityLabel: mapPriority(caseData.priority),
      paymentStatus: caseData.paymentStatus,
      paymentStatusLabel: mapPaymentStatus(caseData.paymentStatus),
      missionState: mapMissionState(caseData.missionState),
      assignedAgentName: caseData.assignedAgentName || null,
      address: caseData.address,
      lga: caseData.lga,
      state: caseData.state,
      beneficiaryName: caseData.beneficiaryName,
      beneficiaryPhone: caseData.beneficiaryPhone,
      slaDeadline: caseData.slaDeadline,
      slaStartedAt: caseData.slaStartedAt,
      completedAt: caseData.completedAt,
      cancelledAt: caseData.cancelledAt,
      cancelReason: caseData.cancelReason,
      createdAt: caseData.createdAt,
      // Customer-safe: only show timeline events visible to customer
      timeline: caseData.timeline,
      // Approved quote details
      approvedQuote: approvedQuote
        ? {
            id: approvedQuote.id,
            amount: approvedQuote.amount,
            breakdown: approvedQuote.breakdown,
            acceptedAt: approvedQuote.acceptedAt,
          }
        : null,
      // Pending quote awaiting customer action
      pendingQuote: pendingQuote
        ? {
            id: pendingQuote.id,
            amount: pendingQuote.amount,
            asojuFee: pendingQuote.asojuFee,
            breakdown: pendingQuote.breakdown,
            validityDays: pendingQuote.validityDays,
            expiresAt: pendingQuote.expiresAt,
            createdAt: pendingQuote.createdAt,
          }
        : null,
      // Payment summary (no internal details)
      paymentSummary: {
        totalPaid,
        approvedAmount: approvedQuote?.amount || caseData.quoteAmount,
        paymentStatus: caseData.paymentStatus,
        paymentStatusLabel: mapPaymentStatus(caseData.paymentStatus),
      },
      // Recent payments (amount, method, status, date only)
      payments: caseData.payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        method: p.method,
        status: p.status,
        statusLabel: mapPaymentStatus(p.status),
        paidAt: p.paidAt,
        createdAt: p.createdAt,
      })),
    });
  } catch (error) {
    console.error('GET /api/customer/cases/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch case' },
      { status: 500 }
    );
  }
}
