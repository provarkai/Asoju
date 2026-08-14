// ═══════════════════════════════════════════════════════════════════════════════
// P0.10 — Dependency Health Endpoint
// GET /api/health/dependencies
// ═══════════════════════════════════════════════════════════════════════════════
// Detailed dependency health status for operations monitoring.
// Includes database, outbox, circuit breakers, and system metrics.

import { NextResponse } from 'next/server'
import {
  checkDatabaseHealth,
  checkSchemaReadiness,
  getSystemInfo,
} from '@/lib/db-health'
import { getOutboxMetrics } from '@/lib/outbox'
import { CircuitBreaker } from '@/lib/circuit-breaker'

export async function GET() {
  const [database, schema, system, outbox] = await Promise.all([
    checkDatabaseHealth(),
    checkSchemaReadiness(),
    Promise.resolve(getSystemInfo()),
    getOutboxMetrics(),
  ])

  const circuitBreakers = CircuitBreaker.getAllStats()

  // External provider status (based on circuit breaker states)
  const externalProviders: Record<string, { status: string; state: string; failures: number; lastFailureAt: string | null }> = {}
  for (const [name, stats] of Object.entries(circuitBreakers)) {
    externalProviders[name] = {
      status: stats.state === 'CLOSED' ? 'healthy' : stats.state === 'HALF_OPEN' ? 'degraded' : 'unhealthy',
      state: stats.state,
      failures: stats.failures,
      lastFailureAt: stats.lastFailureAt?.toISOString() ?? null,
    }
  }

  const overallStatus =
    database.status === 'healthy' && schema.status === 'ready'
      ? 'healthy'
      : database.status === 'degraded' || schema.status === 'ready'
        ? 'degraded'
        : 'unhealthy'

  return NextResponse.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    dependencies: {
      database,
      schema,
      system,
    },
    outbox,
    externalProviders,
    circuitBreakers,
  })
}
