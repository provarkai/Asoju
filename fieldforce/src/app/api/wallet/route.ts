import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAgentIdFromRequest } from '@/lib/auth';

// ─── GET /api/wallet ───────────────────────────────────────────────
// Return wallet summary
export async function GET(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

    return NextResponse.json({
      pendingBalance: wallet.pendingBalance,
      qcClearedBalance: wallet.qcClearedBalance,
      availableBalance: wallet.availableBalance,
      totalEarnings: wallet.totalEarnings,
      totalPaid: wallet.totalPaid,
    });
  } catch (error) {
    console.error('GET /api/wallet error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wallet' },
      { status: 500 },
    );
  }
}
