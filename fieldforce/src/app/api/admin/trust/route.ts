// ═══════════════════════════════════════════════════════════════════════════════
// Admin Trust Score Management
// GET  — Leaderboard or single agent profile
// POST — Recalculate trust scores
// ═══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { db } from '@/lib/db';
import {
  getAgentTrustProfile,
  getTrustLeaderboard,
  calculateAgentTrustScore,
  bulkRecalculateTrustScores,
  TRUST_TIERS,
} from '@/lib/trust-score';

// ─── GET: Trust Leaderboard or Agent Profile ─────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const tier = searchParams.get('tier') || undefined;
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));

    // Single agent profile
    if (agentId) {
      const profile = await getAgentTrustProfile(agentId);
      return NextResponse.json({ profile });
    }

    // Leaderboard with optional tier filter
    const leaderboard = await getTrustLeaderboard(limit, tier);

    // Tier distribution stats
    const tierGroups = await db.agentTrustScore.groupBy({
      by: ['trustTier'],
      _count: { agentId: true },
    });

    const distribution: Record<string, number> = {};
    for (const tierDef of TRUST_TIERS) {
      distribution[tierDef.tier] = 0;
    }
    for (const group of tierGroups) {
      distribution[group.trustTier] = group._count.agentId;
    }

    return NextResponse.json({
      leaderboard,
      distribution,
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN TRUST] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST: Recalculate Trust Scores ──────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);

    const body = await request.json();
    const { action, agentId } = body;

    if (!action || !['recalculate', 'recalculate_all'].includes(action)) {
      return NextResponse.json(
        { error: 'Action must be recalculate or recalculate_all' },
        { status: 400 },
      );
    }

    if (action === 'recalculate') {
      if (!agentId) {
        return NextResponse.json(
          { error: 'agentId is required for recalculate action' },
          { status: 400 },
        );
      }

      const result = await calculateAgentTrustScore(agentId);
      return NextResponse.json({
        message: 'Trust score recalculated',
        score: result,
      });
    }

    // recalculate_all
    const result = await bulkRecalculateTrustScores();
    return NextResponse.json({
      message: 'Bulk trust recalculation complete',
      ...result,
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN TRUST] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
