// ═══════════════════════════════════════════════════════════════════════════════
// MOAT BUILDER — Agent Financial Planning
// GET /api/agent/financial-plan
// ═══════════════════════════════════════════════════════════════════════════════
// Same auth pattern as GET /api/agent — cookie/JWT-derived agentId, 401 if
// absent. ?monthsBack=N lets the app tune the trailing window (defaults to
// 6); clamped to a sane range so a bad query param can't force an
// unbounded WalletEntry scan.

import { NextRequest, NextResponse } from 'next/server';
import { getAgentIdFromRequest } from '@/lib/auth';
import { getFinancialPlan } from '@/lib/financial-planning';

const MIN_MONTHS_BACK = 1;
const MAX_MONTHS_BACK = 24;
const DEFAULT_MONTHS_BACK = 6;

export async function GET(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const raw = parseInt(searchParams.get('monthsBack') ?? '', 10);
    const monthsBack = Number.isFinite(raw)
      ? Math.min(MAX_MONTHS_BACK, Math.max(MIN_MONTHS_BACK, raw))
      : DEFAULT_MONTHS_BACK;

    const plan = await getFinancialPlan(agentId, monthsBack);
    return NextResponse.json(plan);
  } catch (error) {
    console.error('GET /api/agent/financial-plan error:', error);
    return NextResponse.json({ error: 'Failed to build financial plan' }, { status: 500 });
  }
}
