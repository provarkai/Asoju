// ═══════════════════════════════════════════════════════════════════════════════
// P0.10 — Admin Outbox Management API
// GET  /api/admin/outbox — List outbox messages with filters
// POST /api/admin/outbox — Replay dead-lettered messages
// ═══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getOutboxMetrics, replayDeadLetter } from '@/lib/outbox'
import { requireAdminAuth } from '@/lib/bola'

// ─── GET: List outbox messages ─────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await requireAdminAuth(request)
  if (auth) return auth

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const eventType = searchParams.get('eventType')
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100)

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (eventType) where.eventType = eventType

  const [messages, total, metrics] = await Promise.all([
    db.outboxMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        aggregateType: true,
        aggregateId: true,
        eventType: true,
        eventVersion: true,
        source: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        nextRetryAt: true,
        lastError: true,
        lastAttemptAt: true,
        targetType: true,
        targetUrl: true,
        correlationId: true,
        createdAt: true,
        deliveredAt: true,
        deadLetteredAt: true,
      },
    }),
    db.outboxMessage.count({ where }),
    getOutboxMetrics(),
  ])

  return NextResponse.json({
    messages,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
    metrics,
  })
}

// ─── POST: Replay dead-lettered message ────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await requireAdminAuth(request)
  if (auth) return auth

  const body = await request.json()
  const { action, messageId, maxAttempts } = body

  if (action === 'replay' && messageId) {
    const result = await replayDeadLetter(messageId, maxAttempts)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ success: true, messageId })
  }

  if (action === 'cleanup') {
    const { cleanupOutbox } = await import('@/lib/outbox')
    const result = await cleanupOutbox(30) // Clean messages older than 30 days
    return NextResponse.json({ success: true, deleted: result.deleted })
  }

  return NextResponse.json(
    { error: 'Invalid action. Use "replay" or "cleanup".' },
    { status: 400 }
  )
}
