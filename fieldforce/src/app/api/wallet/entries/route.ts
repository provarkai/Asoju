import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAgentIdFromRequest } from '@/lib/auth';

// ─── GET /api/wallet/entries ─────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const entries = await db.walletEntry.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json(
      entries.map((e) => ({
        id: e.id,
        type: e.type,
        amount: e.amount,
        description: e.description,
        referenceId: e.referenceId,
        createdAt: e.createdAt.toISOString(),
      })),
    );
  } catch (error) {
    console.error('GET /api/wallet/entries error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wallet entries' },
      { status: 500 },
    );
  }
}
