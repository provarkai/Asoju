// ═══════════════════════════════════════════════════════════════════════════════
// P0.10 — Liveness Health Endpoint
// GET /api/health
// ═══════════════════════════════════════════════════════════════════════════════
// Simple liveness probe — returns 200 if the process is running.
// Used by container orchestrators and load balancers to confirm the
// service process is alive. No dependency checks.

import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    status: 'alive',
    service: 'fieldforce',
    version: '4.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
}
