// ═══════════════════════════════════════════════════════════════════════════════
// P0.5 — Evidence Custody Chain API
// GET /api/evidence/custody?evidenceId=xxx — Get custody chain for evidence
// ═══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { getEvidenceCustodyChain } from '@/lib/evidence-custody'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const evidenceId = searchParams.get('evidenceId')

  if (!evidenceId) {
    return NextResponse.json({ error: 'evidenceId is required' }, { status: 400 })
  }

  const chain = await getEvidenceCustodyChain(evidenceId)

  return NextResponse.json({
    evidenceId,
    chain,
    chainLength: chain.length,
  })
}
