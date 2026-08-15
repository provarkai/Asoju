import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAgentAuth, withSecurityHeaders } from '@/lib/bola';
import {
  generateProviderReference,
  generatePayoutIdempotencyKey,
  isPaystackConfigured,
} from '@/lib/paystack';
import { postPayoutRequest, seedChartOfAccounts } from '@/lib/ledger';

// ─── GET /api/earnings ────────────────────────────────────────────────
// Fetch wallet summary + payout records (BOLA protected)

export async function GET(request: NextRequest) {
  try {
    const auth = requireAgentAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { agentId } = auth;

    // Ensure wallet account exists
    let wallet = await db.walletAccount.findUnique({
      where: { agentId },
    });

    if (!wallet) {
      const agent = await db.agent.findUnique({ where: { id: agentId } });
      wallet = await db.walletAccount.create({
        data: {
          agentId,
          pendingBalance: agent?.pendingBalance ?? 0,
          qcClearedBalance: agent?.qcClearedBalance ?? 0,
          availableBalance: 0,
          totalEarnings: agent?.totalEarnings ?? 0,
          totalPaid: 0,
        },
      });
    }

    // Seed demo payouts only when the agent has none
    const existingPayouts = await db.payout.findMany({
      where: { agentId },
      orderBy: { requestedAt: 'desc' },
    });

    if (existingPayouts.length === 0) {
      const demoPayouts = [
        {
          agentId,
          amount: 15000,
          asojuFee: 1500,
          netAmount: 13500,
          status: 'SUCCESS',
          paystackReference: 'PSTK_0012345678',
          providerReference: 'ASOJU_PAYOUT_DEMO_001',
          missionTitle: 'Property Inspection - 3BR Flat',
          requestedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          paidAt: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000),
        },
        {
          agentId,
          amount: 8000,
          asojuFee: 800,
          netAmount: 7200,
          status: 'SUCCESS',
          paystackReference: 'PSTK_0012345679',
          providerReference: 'ASOJU_PAYOUT_DEMO_002',
          missionTitle: 'Document Collection - Land Title',
          requestedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
          paidAt: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000),
        },
        {
          agentId,
          amount: 20000,
          asojuFee: 2000,
          netAmount: 18000,
          status: 'SUCCESS',
          paystackReference: 'PSTK_0012345680',
          providerReference: 'ASOJU_PAYOUT_DEMO_003',
          missionTitle: 'Construction Site Progress Check',
          requestedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
          paidAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000),
        },
        {
          agentId,
          amount: 5000,
          asojuFee: 500,
          netAmount: 4500,
          status: 'SUCCESS',
          paystackReference: 'PSTK_0012345681',
          providerReference: 'ASOJU_PAYOUT_DEMO_004',
          missionTitle: 'Delivery Verification - Electronics',
          requestedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          paidAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        },
        {
          agentId,
          amount: 12000,
          asojuFee: 1200,
          netAmount: 10800,
          status: 'PROCESSING',
          paystackReference: 'PSTK_0012345682',
          providerReference: 'ASOJU_PAYOUT_DEMO_005',
          missionTitle: 'Property Inspection - Office Space',
          requestedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        },
        {
          agentId,
          amount: 18000,
          asojuFee: 1800,
          netAmount: 16200,
          status: 'REQUESTED',
          missionTitle: 'Business Verification - Tech Startup',
          requestedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        },
      ];

      await db.payout.createMany({ data: demoPayouts });
    }

    const payouts = await db.payout.findMany({
      where: { agentId },
      orderBy: { requestedAt: 'desc' },
    });

    // Re-read wallet after potential seeding
    const freshWallet = await db.walletAccount.findUnique({
      where: { agentId },
    });

    const response = NextResponse.json({
      payouts,
      walletSummary: {
        pendingBalance: freshWallet?.pendingBalance ?? 0,
        qcClearedBalance: freshWallet?.qcClearedBalance ?? 0,
        availableBalance: freshWallet?.availableBalance ?? 0,
        totalEarnings: freshWallet?.totalEarnings ?? 0,
        totalPaid: freshWallet?.totalPaid ?? 0,
      },
    });
    return withSecurityHeaders(response);

  } catch (error) {
    console.error('GET /api/earnings error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch earnings' },
      { status: 500 },
    );
  }
}

// ─── POST /api/earnings ─────────────────────────────────────────────
// Request a payout (P0.8: with double-entry ledger and idempotency)

export async function POST(request: NextRequest) {
  try {
    const auth = requireAgentAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { agentId } = auth;
    const { amount } = await request.json();

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    const agent = await db.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Check wallet available balance
    const wallet = await db.walletAccount.findUnique({
      where: { agentId },
    });

    const available = wallet?.availableBalance ?? 0;
    if (amount > available) {
      return NextResponse.json(
        { error: `Insufficient available balance. Available: ₦${available.toLocaleString()}` },
        { status: 400 },
      );
    }

    const asojuFee = Math.round(amount * 0.1);
    const netAmount = amount - asojuFee;

    // Generate idempotency key
    const idempotencyKey = generatePayoutIdempotencyKey(agentId);
    const providerReference = generateProviderReference('pending');

    // Check for duplicate idempotency key
    const existingPayout = await db.payout.findUnique({
      where: { idempotencyKey },
    });
    if (existingPayout) {
      const response = NextResponse.json(existingPayout, { status: 409 });
      return withSecurityHeaders(response);
    }

    // Create payout record
    const payout = await db.payout.create({
      data: {
        agentId,
        amount,
        asojuFee,
        netAmount,
        status: 'REQUESTED',
        idempotencyKey,
        providerReference,
        bankCode: agent.bankCode,
        accountNumber: agent.accountNumber,
        accountName: agent.accountName,
      },
    });

    // Post double-entry ledger: Payout request
    await seedChartOfAccounts();
    const ledgerResult = await postPayoutRequest({
      payoutId: payout.id,
      agentId,
      amount,
    });

    if (ledgerResult.success && ledgerResult.journalEntryId) {
      await db.payout.update({
        where: { id: payout.id },
        data: { journalEntryId: ledgerResult.journalEntryId },
      });
    }

    // Deduct from wallet available balance (read model projection)
    if (wallet) {
      await db.walletAccount.update({
        where: { id: wallet.id },
        data: {
          availableBalance: { decrement: amount },
        },
      });

      // Create wallet entry for payout
      await db.walletEntry.create({
        data: {
          agentId,
          walletAccountId: wallet.id,
          type: 'PAYOUT',
          amount: -amount,
          description: `Payout requested: ₦${netAmount.toLocaleString()} (fee: ₦${asojuFee.toLocaleString()})`,
          referenceId: payout.id,
        },
      });
    }

    // Create AuditEvent
    await db.auditEvent.create({
      data: {
        actorType: 'AGENT',
        actorId: agentId,
        action: 'PAYOUT_REQUESTED',
        entityType: 'Payout',
        entityId: payout.id,
        metadata: JSON.stringify({ amount, asojuFee, netAmount, idempotencyKey }),
      },
    });

    const response = NextResponse.json(payout, { status: 201 });
    return withSecurityHeaders(response);

  } catch (error) {
    console.error('POST /api/earnings error:', error);
    return NextResponse.json(
      { error: 'Failed to request payout' },
      { status: 500 },
    );
  }
}
