// ═══════════════════════════════════════════════════════════════════════════════
// P0.10 — Readiness Health Endpoint
// GET /api/health/ready
// ═══════════════════════════════════════════════════════════════════════════════
// Readiness probe — checks critical dependencies before accepting traffic.
// Returns 200 if ready, 503 if any critical dependency is unhealthy.

import { NextResponse } from 'next/server'
import { getReadinessReport } from '@/lib/db-health'

export async function GET() {
  const report = await getReadinessReport()

  if (report.status === 'not_ready') {
    return NextResponse.json(
      {
        status: 'not_ready',
        database: report.database,
        schema: report.schema,
        checkedAt: report.checkedAt,
      },
      { status: 503 }
    )
  }

  return NextResponse.json(report)
}
