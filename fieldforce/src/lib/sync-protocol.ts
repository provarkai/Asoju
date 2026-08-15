// ═══════════════════════════════════════════════════════════════════════════════
// P0.6 OFFLINE-FIRST SYNCHRONIZATION — Sync Protocol & Conflict Resolution
// ═══════════════════════════════════════════════════════════════════════════════
//
// Lifecycle: LOCAL → QUEUED → UPLOADING → SYNCED
// Failures:   UPLOADING → FAILED → retry with exponential backoff
// Conflicts:  UPLOADING → CONFLICT → resource-specific resolution
//
// Conflict Resolution Policies:
//   - Evidence:     Append-only (new version, never overwrite)
//   - GPS checks:   Append-only (each check is a new record)
//   - Checklist:    Append-only (each event is a new record)
//   - Mission state: Server wins (server-authoritative state machine)
//   - Wallet/Finance: Server wins (financial data is server-authoritative)
//
// Critical: Network timeout after server success must NEVER cause duplicate
// operations. mutationId/idempotencyKey is persisted and checked server-side.
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db'

// ─── Sync Status ────────────────────────────────────────────────────────────

export const SYNC_STATUS = {
  QUEUED: 'QUEUED',
  UPLOADING: 'UPLOADING',
  SYNCED: 'SYNCED',
  FAILED: 'FAILED',
  CONFLICT: 'CONFLICT',
} as const

export type SyncStatus = (typeof SYNC_STATUS)[keyof typeof SYNC_STATUS]

// ─── Operation Types ───────────────────────────────────────────────────────

export const SYNC_OPERATION_TYPES = {
  EVIDENCE_UPLOAD: 'EVIDENCE_UPLOAD',
  GPS_CHECK: 'GPS_CHECK',
  CHECKLIST_UPDATE: 'CHECKLIST_UPDATE',
  MISSION_TRANSITION: 'MISSION_TRANSITION',
  MISSION_CHECKLIST: 'MISSION_CHECKLIST',
  EXPENSE_CREATE: 'EXPENSE_CREATE',
} as const

// ─── Conflict Resolution Policies ──────────────────────────────────────────

export type ConflictPolicy = 'APPEND_ONLY' | 'SERVER_WINS' | 'CLIENT_WINS' | 'MANUAL_REVIEW'

export const RESOURCE_CONFLICT_POLICIES: Record<string, ConflictPolicy> = {
  Evidence: 'APPEND_ONLY',
  GpsCheck: 'APPEND_ONLY',
  ChecklistEvent: 'APPEND_ONLY',
  Mission: 'SERVER_WINS',
  WalletAccount: 'SERVER_WINS',
  WalletEntry: 'SERVER_WINS',
  Payout: 'SERVER_WINS',
  JournalEntry: 'SERVER_WINS',
  Expense: 'APPEND_ONLY',
}

export function getConflictPolicy(resourceType: string): ConflictPolicy {
  return RESOURCE_CONFLICT_POLICIES[resourceType] ?? 'SERVER_WINS'
}

// ─── Sync Envelope (client → server) ────────────────────────────────────────

export interface SyncEnvelope {
  agentId: string
  operationType: string
  resourceType?: string
  resourceId?: string
  clientVersion?: number
  payload: Record<string, unknown>
  idempotencyKey: string
  missionId?: string
  capturedAt?: string
}

// ─── Sync Result (server → client) ──────────────────────────────────────────

export interface SyncResult {
  success: boolean
  idempotencyKey: string
  status: SyncStatus
  serverVersion?: number
  serverState?: Record<string, unknown>
  error?: string
  conflictPolicy?: ConflictPolicy
  conflictDetails?: string
}

// ─── Process Sync Mutation ──────────────────────────────────────────────────
// Main entry point for processing a single queued mutation.

export async function processSyncMutation(
  envelope: SyncEnvelope
): Promise<SyncResult> {
  const baseResult: SyncResult = {
    success: false,
    idempotencyKey: envelope.idempotencyKey,
    status: SYNC_STATUS.SYNCED,
  }

  try {
    // 1. Check idempotency — already synced?
    const existing = await db.offlineQueue.findUnique({
      where: { idempotencyKey: envelope.idempotencyKey },
    })

    if (existing && existing.status === SYNC_STATUS.SYNCED) {
      return {
        ...baseResult,
        success: true,
        status: SYNC_STATUS.SYNCED,
        serverVersion: undefined, // Already applied
      }
    }

    // 2. Mark as UPLOADING
    if (existing) {
      await db.offlineQueue.update({
        where: { idempotencyKey: envelope.idempotencyKey },
        data: { status: SYNC_STATUS.UPLOADING },
      })
    }

    // 3. Check for conflicts based on resource type
    if (envelope.resourceType && envelope.resourceId) {
      const policy = getConflictPolicy(envelope.resourceType)
      const conflict = await detectConflict(envelope)

      if (conflict.hasConflict) {
        if (policy === 'SERVER_WINS') {
          // Server wins: mark as synced with server state, no mutation applied
          return {
            ...baseResult,
            success: true,
            status: SYNC_STATUS.SYNCED,
            conflictPolicy: policy,
            serverState: conflict.serverState,
          }
        }

        if (policy === 'APPEND_ONLY') {
          // Append-only: always create new record, no conflict
          // Proceed with normal processing below
        }

        if (policy === 'MANUAL_REVIEW') {
          return {
            ...baseResult,
            success: false,
            status: SYNC_STATUS.CONFLICT,
            conflictPolicy: policy,
            conflictDetails: JSON.stringify(conflict),
          }
        }
      }
    }

    // 4. Process the mutation (dispatch to specific handler)
    // The actual mutation processing depends on operation type
    // This is handled by the specific API routes that receive the sync request
    const result = await dispatchSyncOperation(envelope)

    // 5. Mark as SYNCED
    await markQueueItemSynced(envelope.idempotencyKey, envelope.agentId)

    return {
      ...baseResult,
      ...result,
      status: SYNC_STATUS.SYNCED,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown sync error'

    // Mark as FAILED
    await markQueueItemFailed(envelope.idempotencyKey, errorMessage)

    return {
      ...baseResult,
      status: SYNC_STATUS.FAILED,
      error: errorMessage,
    }
  }
}

// ─── Conflict Detection ─────────────────────────────────────────────────────

async function detectConflict(envelope: SyncEnvelope): Promise<{
  hasConflict: boolean
  serverState?: Record<string, unknown>
}> {
  if (!envelope.resourceType || !envelope.resourceId) {
    return { hasConflict: false }
  }

  // For mission state transitions: check if server state has changed
  if (envelope.resourceType === 'Mission' && envelope.operationType === SYNC_OPERATION_TYPES.MISSION_TRANSITION) {
    const mission = await db.mission.findUnique({
      where: { id: envelope.resourceId },
      select: { workflowState: true, updatedAt: true },
    })

    if (mission) {
      const clientExpectedState = envelope.payload.workflowState as string | undefined
      if (clientExpectedState && mission.workflowState !== clientExpectedState) {
        return {
          hasConflict: true,
          serverState: {
            workflowState: mission.workflowState,
            updatedAt: mission.updatedAt.toISOString(),
          },
        }
      }
    }
  }

  return { hasConflict: false }
}

// ─── Operation Dispatch ──────────────────────────────────────────────────────
// Routes sync operations to the appropriate domain handler.
// In production, these would call the same domain services as the REST API.

async function dispatchSyncOperation(
  envelope: SyncEnvelope
): Promise<{ success: boolean; serverVersion?: number; error?: string }> {
  // The sync API endpoint will handle the actual mutation
  // This function is a stub that the actual sync route uses
  return { success: true }
}

// ─── Queue Management ────────────────────────────────────────────────────────

async function markQueueItemSynced(idempotencyKey: string, agentId: string): Promise<void> {
  await db.offlineQueue.updateMany({
    where: { idempotencyKey },
    data: {
      status: SYNC_STATUS.SYNCED,
      syncedAt: new Date(),
    },
  })
}

async function markQueueItemFailed(idempotencyKey: string, error: string): Promise<void> {
  const item = await db.offlineQueue.findUnique({
    where: { idempotencyKey },
  })

  if (!item) return

  const newRetryCount = item.retryCount + 1

  if (newRetryCount >= item.maxRetries) {
    // Exhausted retries — keep as FAILED for manual review
    await db.offlineQueue.update({
      where: { idempotencyKey },
      data: {
        status: SYNC_STATUS.FAILED,
        retryCount: newRetryCount,
        error,
      },
    })
  } else {
    // Exponential backoff: 2s base, max 5min
    const baseDelayMs = 2000
    const maxDelayMs = 5 * 60 * 1000
    const delayMs = Math.min(baseDelayMs * Math.pow(2, newRetryCount - 1), maxDelayMs)

    await db.offlineQueue.update({
      where: { idempotencyKey },
      data: {
        status: SYNC_STATUS.QUEUED,
        retryCount: newRetryCount,
        nextRetryAt: new Date(Date.now() + delayMs),
        error,
      },
    })
  }
}

// ─── Resolve Conflict ───────────────────────────────────────────────────────
// Admin operation to resolve a conflicted sync item.

export async function resolveConflict(
  idempotencyKey: string,
  resolution: {
    action: 'ACCEPT_CLIENT' | 'ACCEPT_SERVER' | 'DISCARD'
    resolvedBy: string
    notes?: string
  }
): Promise<{ success: boolean; error?: string }> {
  const item = await db.offlineQueue.findUnique({
    where: { idempotencyKey },
  })

  if (!item) return { success: false, error: 'Queue item not found' }
  if (item.status !== SYNC_STATUS.CONFLICT && item.status !== SYNC_STATUS.FAILED) {
    return { success: false, error: 'Item is not in conflict/failed state' }
  }

  await db.offlineQueue.update({
    where: { idempotencyKey },
    data: {
      status: resolution.action === 'DISCARD' ? SYNC_STATUS.SYNCED : SYNC_STATUS.SYNCED,
      resolvedBy: resolution.resolvedBy,
      resolvedAt: new Date(),
      conflictDetails: resolution.notes ? JSON.stringify({ resolution, notes: resolution.notes }) : undefined,
    },
  })

  return { success: true }
}

// ─── Sync Queue Status ────────────────────────────────────────────────────

export interface SyncQueueStatus {
  agentId: string
  queued: number
  uploading: number
  synced: number
  failed: number
  conflicts: number
  lastSyncAt: Date | null
}

export async function getSyncQueueStatus(agentId: string): Promise<SyncQueueStatus> {
  const [queued, uploading, synced, failed, conflicts, lastSync] = await Promise.all([
    db.offlineQueue.count({ where: { agentId, status: SYNC_STATUS.QUEUED } }),
    db.offlineQueue.count({ where: { agentId, status: SYNC_STATUS.UPLOADING } }),
    db.offlineQueue.count({ where: { agentId, status: SYNC_STATUS.SYNCED } }),
    db.offlineQueue.count({ where: { agentId, status: SYNC_STATUS.FAILED } }),
    db.offlineQueue.count({ where: { agentId, status: SYNC_STATUS.CONFLICT } }),
    db.offlineQueue.findFirst({
      where: { agentId, status: SYNC_STATUS.SYNCED },
      orderBy: { syncedAt: 'desc' },
      select: { syncedAt: true },
    }),
  ])

  return {
    agentId,
    queued,
    uploading,
    synced,
    failed,
    conflicts,
    lastSyncAt: lastSync?.syncedAt ?? null,
  }
}
