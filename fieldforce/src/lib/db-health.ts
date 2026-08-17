// ═══════════════════════════════════════════════════════════════════════════════
// P0.10 PRODUCTION RELIABILITY — Database Health Checks
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db'

// ─── Health Status ─────────────────────────────────────────────────────────

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  latencyMs: number
  details?: string
  checkedAt: string
}

// ─── Database Health Check ───────────────────────────────────────────────────
// Runs a lightweight query to verify DB connectivity and response time.

export async function checkDatabaseHealth(): Promise<HealthStatus> {
  const start = Date.now()
  const checkedAt = new Date().toISOString()

  try {
    // Lightweight query — just get the count of one small table
    const count = await db.agentTier.count({
      take: 0, // No data retrieval, just connectivity check
    })

    const latencyMs = Date.now() - start

    if (latencyMs > 5000) {
      return {
        status: 'degraded',
        latencyMs,
        details: 'Database response time exceeds 5s threshold',
        checkedAt,
      }
    }

    return {
      status: 'healthy',
      latencyMs,
      details: `Connected (tiers: ${count})`,
      checkedAt,
    }
  } catch (error) {
    const latencyMs = Date.now() - start
    return {
      status: 'unhealthy',
      latencyMs,
      details: error instanceof Error ? error.message : 'Unknown database error',
      checkedAt,
    }
  }
}

// ─── Schema Readiness Check ────────────────────────────────────────────────
// Verifies that all required tables exist (P0.10 outbox tables, P0.8 ledger, etc.)

export interface SchemaReadiness {
  status: 'ready' | 'not_ready'
  missingTables: string[]
  checkedAt: string
}

export async function checkSchemaReadiness(): Promise<SchemaReadiness> {
  const checkedAt = new Date().toISOString()
  const requiredTables = [
    'Agent', 'AgentTier', 'Mission', 'MissionAssignment',
    'Case', 'CaseMessage', 'Customer', 'CustomerRequest',
    'AdminUser', 'WalletAccount', 'WalletEntry', 'Payout',
    'EvidenceItem', 'GpsCheck', 'JournalEntry', 'JournalLine',
    'LedgerAccount', 'FinanceException', 'QcReview',
    'OutboxMessage', 'IdempotencyRecord', 'Notification',
    'AuditEvent', 'AdminAuditEvent', 'DeviceSession',
    'OfflineQueue', 'SupportMessage',
  ]

  const missingTables: string[] = []

  // Check each table by attempting a minimal query
  // Using Prisma's $queryRaw to check table existence
  for (const table of requiredTables) {
    try {
      // SQLite-compatible table existence check
      await db.$queryRawUnsafe(
        `SELECT 1 FROM "${table}" LIMIT 1`
      )
    } catch {
      missingTables.push(table)
    }
  }

  return {
    status: missingTables.length === 0 ? 'ready' : 'not_ready',
    missingTables,
    checkedAt,
  }
}

// ─── System Info ───────────────────────────────────────────────────────────

export interface SystemInfo {
  environment: string
  databaseProvider: string
  nodeVersion: string
  uptimeSeconds: number
  memoryUsage: {
    rssMb: number
    heapTotalMb: number
    heapUsedMb: number
  }
}

export function getSystemInfo(): SystemInfo {
  const memory = process.memoryUsage()
  return {
    environment: process.env.NODE_ENV ?? 'development',
    databaseProvider: 'sqlite',
    nodeVersion: process.version,
    uptimeSeconds: process.uptime(),
    memoryUsage: {
      rssMb: Math.round(memory.rss / (1024 * 1024)),
      heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024)),
      heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
    },
  }
}

// ─── Aggregate Readiness ───────────────────────────────────────────────────

export interface ReadinessReport {
  status: 'ready' | 'not_ready'
  database: HealthStatus
  schema: SchemaReadiness
  system: SystemInfo
  outbox: {
    pending: number
    deadLetter: number
  }
  circuitBreakers: Record<string, { state: string; failures: number }>
  checkedAt: string
}

export async function getReadinessReport(): Promise<ReadinessReport> {
  const [database, schema, outboxMetrics] = await Promise.all([
    checkDatabaseHealth(),
    checkSchemaReadiness(),
    getOutboxQuickStats(),
  ])

  const circuitBreakers: Record<string, { state: string; failures: number }> = {}
  try {
    const { CircuitBreaker } = await import('@/lib/circuit-breaker')
    const stats = CircuitBreaker.getAllStats()
    for (const [name, stat] of Object.entries(stats)) {
      circuitBreakers[name] = { state: stat.state, failures: stat.failures }
    }
  } catch {
    // Circuit breaker module not loaded yet
  }

  const system = getSystemInfo()

  const isReady =
    database.status === 'healthy' &&
    schema.status === 'ready'

  return {
    status: isReady ? 'ready' : 'not_ready',
    database,
    schema,
    system,
    outbox: outboxMetrics,
    circuitBreakers,
    checkedAt: new Date().toISOString(),
  }
}

async function getOutboxQuickStats(): Promise<{ pending: number; deadLetter: number }> {
  try {
    const [pending, deadLetter] = await Promise.all([
      db.outboxMessage.count({ where: { status: 'PENDING' } }),
      db.outboxMessage.count({ where: { status: 'DEAD_LETTER' } }),
    ])
    return { pending, deadLetter }
  } catch {
    return { pending: 0, deadLetter: 0 }
  }
}
