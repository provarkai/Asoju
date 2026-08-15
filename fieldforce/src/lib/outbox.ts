// ═══════════════════════════════════════════════════════════════════════════════
// P0.10 PRODUCTION RELIABILITY — Transactional Outbox Pattern
// ═══════════════════════════════════════════════════════════════════════════════
//
// Core Invariant: The domain mutation and its outbound event MUST commit in
// the same database transaction. A background worker then claims, delivers,
// and marks the event. This prevents the failure mode where the business
// transaction succeeds but its integration event disappears.
//
// Lifecycle: PENDING → PROCESSING → DELIVERED
// Failure:   PROCESSING → FAILED → retry with exponential backoff
// Exhausted: FAILED → DEAD_LETTER → manual replay/recovery
//
// Usage:
//   await db.$transaction(async (tx) => {
//     await tx.mission.update({ ... });
//     await publishEvent(tx, { aggregateType: 'Mission', ... });
//   });
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { v4 as uuidv4 } from 'uuid'

// ─── Event Types ────────────────────────────────────────────────────────────

export const OUTBOX_EVENT_TYPES = {
  // Mission events
  MISSION_CREATED: 'MISSION_CREATED',
  MISSION_ASSIGNED: 'MISSION_ASSIGNED',
  MISSION_TRANSITIONED: 'MISSION_TRANSITIONED',
  MISSION_COMPLETED: 'MISSION_COMPLETED',
  MISSION_FAILED: 'MISSION_FAILED',
  MISSION_ESCALATED: 'MISSION_ESCALATED',

  // Case events
  CASE_CREATED: 'CASE_CREATED',
  CASE_STATUS_CHANGED: 'CASE_STATUS_CHANGED',

  // Payout events
  PAYOUT_REQUESTED: 'PAYOUT_REQUESTED',
  PAYOUT_PROCESSING: 'PAYOUT_PROCESSING',
  PAYOUT_SUCCESS: 'PAYOUT_SUCCESS',
  PAYOUT_FAILED: 'PAYOUT_FAILED',
  PAYOUT_REVERSED: 'PAYOUT_REVERSED',

  // Finance events
  JOURNAL_POSTED: 'JOURNAL_POSTED',
  JOURNAL_REVERSED: 'JOURNAL_REVERSED',
  FINANCE_EXCEPTION: 'FINANCE_EXCEPTION',

  // QC events
  QC_STARTED: 'QC_STARTED',
  QC_APPROVED: 'QC_APPROVED',
  QC_REJECTED: 'QC_REJECTED',
  QC_REWORK_REQUESTED: 'QC_REWORK_REQUESTED',

  // Customer events
  CUSTOMER_PAYMENT_RECEIVED: 'CUSTOMER_PAYMENT_RECEIVED',
  CUSTOMER_CASE_UPDATED: 'CUSTOMER_CASE_UPDATED',

  // Integration events
  INTEGRATION_SYNC: 'INTEGRATION_SYNC',
} as const

export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[keyof typeof OUTBOX_EVENT_TYPES]

// ─── Outbox Status ──────────────────────────────────────────────────────────

export const OUTBOX_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  DEAD_LETTER: 'DEAD_LETTER',
} as const

export type OutboxStatus = (typeof OUTBOX_STATUS)[keyof typeof OUTBOX_STATUS]

// ─── Target Types ───────────────────────────────────────────────────────────

export const OUTBOX_TARGET = {
  WEBHOOK: 'WEBHOOK',
  INTERNAL: 'INTERNAL',
  INTEGRATION: 'INTEGRATION',
} as const

// ─── Event Source ───────────────────────────────────────────────────────────

export const OUTBOX_SOURCE = {
  FIELDFORCE: 'FIELDFORCE',
  ADMIN: 'ADMIN',
  AGENT: 'AGENT',
  CUSTOMER: 'CUSTOMER',
  WEBHOOK: 'WEBHOOK',
  INTEGRATION: 'INTEGRATION',
} as const

// ─── Publish Event ─────────────────────────────────────────────────────────
// MUST be called inside a Prisma transaction (db.$transaction) with the
// domain mutation. The event and mutation commit atomically.

export interface PublishEventInput {
  aggregateType: string
  aggregateId: string
  eventType: OutboxEventType
  eventVersion?: string
  payload: Record<string, unknown>
  source?: string
  targetUrl?: string
  targetType?: string
  correlationId?: string
}

export async function publishEvent(
  tx: Prisma.TransactionClient,
  input: PublishEventInput
): Promise<string> {
  const idempotencyKey = `evt_${input.eventType}_${input.aggregateType}_${input.aggregateId}_${Date.now()}`

  const message = await tx.outboxMessage.create({
    data: {
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      eventVersion: input.eventVersion ?? '1',
      payload: JSON.stringify(input.payload),
      source: input.source ?? OUTBOX_SOURCE.FIELDFORCE,
      targetUrl: input.targetUrl,
      targetType: input.targetType ?? OUTBOX_TARGET.INTERNAL,
      idempotencyKey,
      correlationId: input.correlationId,
      status: OUTBOX_STATUS.PENDING,
      maxAttempts: 5,
    },
  })

  return message.id
}

// ─── Publish Multiple Events ─────────────────────────────────────────────────
// For operations that generate multiple events (e.g., QC approval → mission complete + earnings posted)

export async function publishEvents(
  tx: Prisma.TransactionClient,
  events: PublishEventInput[]
): Promise<string[]> {
  const ids: string[] = []
  for (const event of events) {
    const id = await publishEvent(tx, event)
    ids.push(id)
  }
  return ids
}

// ─── Claim Pending Messages ────────────────────────────────────────────────
// Worker claims messages that are ready for delivery (PENDING or FAILED with
// nextRetryAt in the past). Uses atomic claim with optimistic concurrency.

export interface ClaimResult {
  claimed: number
  errors: string[]
}

export async function claimPendingMessages(
  limit: number = 20,
  workerId?: string
): Promise<ClaimResult> {
  const now = new Date()
  const errors: string[] = []

  try {
    // Find messages ready for processing
    const messages = await db.outboxMessage.findMany({
      where: {
        status: { in: [OUTBOX_STATUS.PENDING, OUTBOX_STATUS.FAILED] },
        nextRetryAt: { lte: now },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })

    if (messages.length === 0) {
      return { claimed: 0, errors: [] }
    }

    // Atomically claim each message
    let claimedCount = 0
    for (const msg of messages) {
      const result = await db.outboxMessage.updateMany({
        where: {
          id: msg.id,
          status: { in: [OUTBOX_STATUS.PENDING, OUTBOX_STATUS.FAILED] },
        },
        data: {
          status: OUTBOX_STATUS.PROCESSING,
          claimedAt: now,
          attempts: { increment: 1 },
        },
      })

      if (result.count > 0) {
        claimedCount++
      }
    }

    return { claimed: claimedCount, errors }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    errors.push(errMsg)
    return { claimed: 0, errors }
  }
}

// ─── Process Claimed Messages ───────────────────────────────────────────────
// Worker processes messages in PROCESSING state and delivers them.

export interface DeliveryResult {
  delivered: number
  failed: number
  deadLettered: number
}

export async function processClaimedMessages(
  deliverFn: (message: {
    id: string
    eventType: string
    payload: string
    targetUrl: string | null
    targetType: string
    correlationId: string | null
  }) => Promise<{ success: boolean; error?: string }>
): Promise<DeliveryResult> {
  const result: DeliveryResult = { delivered: 0, failed: 0, deadLettered: 0 }

  const messages = await db.outboxMessage.findMany({
    where: { status: OUTBOX_STATUS.PROCESSING },
    orderBy: { createdAt: 'asc' },
    take: 50,
  })

  for (const msg of messages) {
    try {
      const delivery = await deliverFn({
        id: msg.id,
        eventType: msg.eventType,
        payload: msg.payload,
        targetUrl: msg.targetUrl,
        targetType: msg.targetType,
        correlationId: msg.correlationId,
      })

      if (delivery.success) {
        await db.outboxMessage.update({
          where: { id: msg.id },
          data: {
            status: OUTBOX_STATUS.DELIVERED,
            deliveredAt: new Date(),
            lastAttemptAt: new Date(),
          },
        })
        result.delivered++
      } else {
        await markMessageFailed(msg.id, msg.attempts, msg.maxAttempts, delivery.error)
        result.failed++
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error'
      await markMessageFailed(msg.id, msg.attempts, msg.maxAttempts, errMsg)
      result.failed++
    }
  }

  return result
}

// ─── Mark Message Failed ───────────────────────────────────────────────────
// Applies exponential backoff or moves to DEAD_LETTER if retries exhausted.

async function markMessageFailed(
  messageId: string,
  currentAttempt: number,
  maxAttempts: number,
  errorMessage?: string
): Promise<void> {
  if (currentAttempt >= maxAttempts) {
    // Exhausted retries → DEAD_LETTER
    await db.outboxMessage.update({
      where: { id: messageId },
      data: {
        status: OUTBOX_STATUS.DEAD_LETTER,
        deadLetteredAt: new Date(),
        lastError: errorMessage,
        lastAttemptAt: new Date(),
      },
    })
  } else {
    // Exponential backoff: base 2s, max 5min
    const baseDelayMs = 2000
    const maxDelayMs = 5 * 60 * 1000
    const delayMs = Math.min(baseDelayMs * Math.pow(2, currentAttempt - 1), maxDelayMs)
    const nextRetryAt = new Date(Date.now() + delayMs)

    await db.outboxMessage.update({
      where: { id: messageId },
      data: {
        status: OUTBOX_STATUS.FAILED,
        nextRetryAt,
        lastError: errorMessage,
        lastAttemptAt: new Date(),
      },
    })
  }
}

// ─── Replay Dead Letter ────────────────────────────────────────────────────
// Admin operation to replay a dead-lettered message.

export async function replayDeadLetter(
  messageId: string,
  newMaxAttempts?: number
): Promise<{ success: boolean; error?: string }> {
  const message = await db.outboxMessage.findUnique({ where: { id: messageId } })
  if (!message) return { success: false, error: 'Message not found' }
  if (message.status !== OUTBOX_STATUS.DEAD_LETTER) {
    return { success: false, error: 'Message is not in DEAD_LETTER status' }
  }

  await db.outboxMessage.update({
    where: { id: messageId },
    data: {
      status: OUTBOX_STATUS.PENDING,
      attempts: 0,
      maxAttempts: newMaxAttempts ?? message.maxAttempts,
      nextRetryAt: new Date(),
      deadLetteredAt: null,
      lastError: null,
    },
  })

  return { success: true }
}

// ─── Outbox Metrics ─────────────────────────────────────────────────────────

export interface OutboxMetrics {
  pending: number
  processing: number
  delivered: number
  failed: number
  deadLetter: number
  oldestPendingAgeMs: number | null
  queueDepth: number
}

export async function getOutboxMetrics(): Promise<OutboxMetrics> {
  const [pending, processing, delivered, failed, deadLetter] = await Promise.all([
    db.outboxMessage.count({ where: { status: OUTBOX_STATUS.PENDING } }),
    db.outboxMessage.count({ where: { status: OUTBOX_STATUS.PROCESSING } }),
    db.outboxMessage.count({ where: { status: OUTBOX_STATUS.DELIVERED } }),
    db.outboxMessage.count({ where: { status: OUTBOX_STATUS.FAILED } }),
    db.outboxMessage.count({ where: { status: OUTBOX_STATUS.DEAD_LETTER } }),
  ])

  // Find oldest pending message
  const oldestPending = await db.outboxMessage.findFirst({
    where: { status: OUTBOX_STATUS.PENDING },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  })

  return {
    pending,
    processing,
    delivered,
    failed,
    deadLetter,
    oldestPendingAgeMs: oldestPending
      ? Date.now() - oldestPending.createdAt.getTime()
      : null,
    queueDepth: pending + processing + failed,
  }
}

// ─── Outbox Worker Loop ───────────────────────────────────────────────────
// Run in a mini-service or background process. Polls interval.

export interface OutboxWorkerConfig {
  pollIntervalMs?: number
  batchSize?: number
  workerId?: string
  deliverFn: (message: {
    id: string
    eventType: string
    payload: string
    targetUrl: string | null
    targetType: string
    correlationId: string | null
  }) => Promise<{ success: boolean; error?: string }>
}

export function startOutboxWorker(config: OutboxWorkerConfig): {
  start: () => void
  stop: () => void
} {
  const pollIntervalMs = config.pollIntervalMs ?? 5000
  const batchSize = config.batchSize ?? 20
  let running = false
  let timer: ReturnType<typeof setTimeout> | null = null

  async function tick(): Promise<void> {
    if (!running) return

    try {
      const { claimed } = await claimPendingMessages(batchSize, config.workerId)
      if (claimed > 0) {
        await processClaimedMessages(config.deliverFn)
      }
    } catch (error) {
      console.error('[OutboxWorker] Error in tick:', error)
    }

    if (running) {
      timer = setTimeout(tick, pollIntervalMs)
    }
  }

  return {
    start: () => {
      if (!running) {
        running = true
        tick()
      }
    },
    stop: () => {
      running = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}

// ─── Idempotency Check & Record ─────────────────────────────────────────────
// Use this BEFORE processing a mutation to prevent duplicate side effects.

export interface IdempotencyCheckInput {
  idempotencyKey: string
  source: string
  requestHash?: string
}

export interface IdempotencyResult {
  isDuplicate: boolean
  existingRecord?: {
    entityType: string | null
    entityId: string | null
    responseCode: number | null
    responsePayload: string | null
    createdAt: Date
  }
}

export async function checkIdempotency(
  input: IdempotencyCheckInput
): Promise<IdempotencyResult> {
  const existing = await db.idempotencyRecord.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  })

  if (existing) {
    return {
      isDuplicate: true,
      existingRecord: {
        entityType: existing.entityType,
        entityId: existing.entityId,
        responseCode: existing.responseCode,
        responsePayload: existing.responsePayload,
        createdAt: existing.createdAt,
      },
    }
  }

  return { isDuplicate: false }
}

export interface RecordIdempotencyInput {
  idempotencyKey: string
  source: string
  entityType: string
  entityId: string
  requestHash?: string
  responseCode?: number
  responsePayload?: string
}

export async function recordIdempotency(
  input: RecordIdempotencyInput
): Promise<void> {
  // Use createMany with skipDuplicates to handle race conditions
  await db.idempotencyRecord.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      source: input.source,
      entityType: input.entityType,
      entityId: input.entityId,
      requestHash: input.requestHash,
      responseCode: input.responseCode,
      responsePayload: input.responsePayload,
    },
  }).catch(() => {
    // Unique constraint violation — another process already recorded this
    // This is safe to ignore
  })
}

// ─── Cleanup Old Records ───────────────────────────────────────────────────
// Periodically clean up old delivered messages and idempotency records

export async function cleanupOutbox(
  olderThanDays: number = 30
): Promise<{ deleted: number }> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - olderThanDays)

  const result = await db.outboxMessage.deleteMany({
    where: {
      status: OUTBOX_STATUS.DELIVERED,
      deliveredAt: { lt: cutoff },
    },
  })

  return { deleted: result.count }
}

export async function cleanupIdempotencyRecords(
  olderThanDays: number = 30
): Promise<{ deleted: number }> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - olderThanDays)

  const result = await db.idempotencyRecord.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })

  return { deleted: result.count }
}
