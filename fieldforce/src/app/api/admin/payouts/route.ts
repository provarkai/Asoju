// ─── /api/admin/payouts ────────────────────────────────────────────────
// P0.8: Admin payout management — list, release, and manage payouts
// Requires FINANCE or SUPER_ADMIN role (agents cannot self-approve payouts)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminAuth, withSecurityHeaders, canReleasePayout } from '@/lib/bola';
import { generateProviderReference, generatePayoutIdempotencyKey, initiatePaystackTransfer, isPaystackConfigured } from '@/lib/paystack';
import { postPayoutRequest, seedChartOfAccounts } from '@/lib/ledger';

// ─── GET /api/admin/payouts ────────────────────────────────────────────
// List all payouts with filters

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminAuth(request, ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS']);
    if (admin instanceof NextResponse) return admin;

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const status = url.searchParams.get('status');
    const agentId = url.searchParams.get('agentId');

    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (agentId) where.agentId = agentId;

    const [payouts, total] = await Promise.all([
      db.payout.findMany({
        where,
        include: {
          agent: {
            select: {
              id: true,
              displayName: true,
              phone: true,
              bankCode: true,
              accountNumber: true,
              accountName: true,
            },
          },
          journalEntry: {
            select: {
              id: true,
              idempotencyKey: true,
              status: true,
            },
          },
        },
        orderBy: { requestedAt: 'desc' },
        skip,
        take: limit,
      }),
      db.payout.count({ where }),
    ]);

    // Summary stats
    const summaryStats = await db.payout.groupBy({
      by: ['status'],
      _count: { id: true },
      _sum: { amount: true, netAmount: true, asojuFee: true },
    });

    const response = NextResponse.json({
      payouts: payouts.map((p) => ({
        id: p.id,
        amount: p.amount,
        asojuFee: p.asojuFee,
        netAmount: p.netAmount,
        status: p.status,
        paystackReference: p.paystackReference,
        paystackStatus: p.paystackStatus,
        providerReference: p.providerReference,
        idempotencyKey: p.idempotencyKey,
        missionId: p.missionId,
        missionTitle: p.missionTitle,
        failureReason: p.failureReason,
        failureCode: p.failureCode,
        webhookReceivedAt: p.webhookReceivedAt?.toISOString() || null,
        reconciledAt: p.reconciledAt?.toISOString() || null,
        requestedAt: p.requestedAt.toISOString(),
        processingStartedAt: p.processingStartedAt?.toISOString() || null,
        paidAt: p.paidAt?.toISOString() || null,
        failedAt: p.failedAt?.toISOString() || null,
        agent: p.agent,
        journalEntry: p.journalEntry,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summaryByStatus: summaryStats.map((s) => ({
        status: s.status,
        count: s._count.id,
        totalAmount: s._sum.amount || 0,
        totalNetAmount: s._sum.netAmount || 0,
        totalFees: s._sum.asojuFee || 0,
      })),
      paystackConfigured: isPaystackConfigured(),
    });

    return withSecurityHeaders(response);

  } catch (error) {
    console.error('GET /api/admin/payouts error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch payouts' },
      { status: 500 }
    );
  }
}

// ─── POST /api/admin/payouts ──────────────────────────────────────────
// Release/process a payout (admin action — agents cannot self-release)

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminAuth(request, ['SUPER_ADMIN', 'FINANCE']);
    if (admin instanceof NextResponse) return admin;

    const { payoutId, action } = await request.json();

    if (!payoutId || !action) {
      return NextResponse.json(
        { error: 'payoutId and action are required' },
        { status: 400 }
      );
    }

    const payout = await db.payout.findUnique({
      where: { id: payoutId },
      include: {
        agent: {
          select: { displayName: true, bankCode: true, accountNumber: true, accountName: true },
        },
      },
    });

    if (!payout) {
      return NextResponse.json(
        { error: 'Payout not found' },
        { status: 404 }
      );
    }

    if (action === 'release') {
      // Can only release REQUESTED payouts
      if (payout.status !== 'REQUESTED') {
        return NextResponse.json(
          { error: `Cannot release payout in status: ${payout.status}` },
          { status: 422 }
        );
      }

      // Generate idempotent references
      const providerReference = generateProviderReference(payout.id);
      const idempotencyKey = generatePayoutIdempotencyKey(payout.agentId);

      // Check for duplicate idempotency key
      const existingPayout = await db.payout.findUnique({
        where: { idempotencyKey },
      });
      if (existingPayout) {
        return NextResponse.json(
          { error: 'Duplicate payout request detected', code: 'DUPLICATE' },
          { status: 409 }
        );
      }

      // Update payout with references
      await db.payout.update({
        where: { id: payout.id },
        data: {
          status: 'PROCESSING',
          providerReference,
          idempotencyKey,
          processingStartedAt: new Date(),
        },
      });

      // Post double-entry ledger: Payout request (debit escrow, credit available)
      await seedChartOfAccounts();
      const ledgerResult = await postPayoutRequest({
        payoutId: payout.id,
        agentId: payout.agentId,
        amount: payout.amount,
      });

      if (ledgerResult.success && ledgerResult.journalEntryId) {
        await db.payout.update({
          where: { id: payout.id },
          data: { journalEntryId: ledgerResult.journalEntryId },
        });
      }

      // Attempt Paystack transfer (production) or simulate (demo)
      const transferResult = await initiatePaystackTransfer({
        amount: payout.amount * 100, // Convert to kobo for Paystack
        recipient: '', // In production, use Paystack recipient code
        reference: providerReference,
        reason: `ASOJU Payout - ${payout.missionTitle || 'Mission'} - ${payout.agent.displayName}`,
      });

      if (!transferResult.success && isPaystackConfigured()) {
        // Real Paystack failure — mark payout as failed
        await db.payout.update({
          where: { id: payout.id },
          data: {
            status: 'FAILED',
            failureReason: transferResult.error,
            failureCode: 'TRANSFER_INITIATION_FAILED',
            failedAt: new Date(),
          },
        });

        // Record exception
        await db.financeException.create({
          data: {
            type: 'PAYOUT_FAILURE',
            severity: 'HIGH',
            entityType: 'Payout',
            entityId: payout.id,
            description: `Transfer initiation failed: ${transferResult.error}`,
            metadata: JSON.stringify({ transferResult, payoutId: payout.id }),
          },
        });

        const response = NextResponse.json(
          { error: 'Transfer initiation failed', details: transferResult.error },
          { status: 500 }
        );
        return withSecurityHeaders(response);
      }

      // Update with Paystack reference if available
      if (transferResult.reference) {
        await db.payout.update({
          where: { id: payout.id },
          data: {
            paystackReference: transferResult.reference,
          },
        });
      }

      // Audit event
      await db.adminAuditEvent.create({
        data: {
          adminUserId: admin.adminId,
          actorType: 'ADMIN',
          action: 'PAYOUT_RELEASED',
          entityType: 'Payout',
          entityId: payout.id,
          metadata: JSON.stringify({
            amount: payout.amount,
            netAmount: payout.netAmount,
            agentId: payout.agentId,
            providerReference,
            paystackConfigured: isPaystackConfigured(),
          }),
        },
      });

      const updated = await db.payout.findUnique({ where: { id: payout.id } });
      const response = NextResponse.json(updated);
      return withSecurityHeaders(response);

    } else if (action === 'retry') {
      // Retry a failed payout
      if (payout.status !== 'FAILED') {
        return NextResponse.json(
          { error: `Cannot retry payout in status: ${payout.status}` },
          { status: 422 }
        );
      }

      // Reset to PROCESSING and retry
      await db.payout.update({
        where: { id: payout.id },
        data: {
          status: 'PROCESSING',
          failureReason: null,
          failureCode: null,
          processingStartedAt: new Date(),
        },
      });

      await db.adminAuditEvent.create({
        data: {
          adminUserId: admin.adminId,
          actorType: 'ADMIN',
          action: 'PAYOUT_RETRIED',
          entityType: 'Payout',
          entityId: payout.id,
          metadata: JSON.stringify({ previousStatus: 'FAILED', amount: payout.amount }),
        },
      });

      const updated = await db.payout.findUnique({ where: { id: payout.id } });
      const response = NextResponse.json(updated);
      return withSecurityHeaders(response);

    } else {
      return NextResponse.json(
        { error: 'Invalid action. Use "release" or "retry"' },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('POST /api/admin/payouts error:', error);
    return NextResponse.json(
      { error: 'Failed to process payout action' },
      { status: 500 }
    );
  }
}
