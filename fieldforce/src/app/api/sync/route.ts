// ═══════════════════════════════════════════════════════════════════════════════
// P0.6 — Offline Sync API
// POST /api/sync — Process queued mutations from offline clients
// GET  /api/sync?agentId=xxx — Get sync queue status
// ═══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAgentIdFromRequest } from '@/lib/auth'
import {
  processSyncMutation,
  getSyncQueueStatus,
  resolveConflict,
  SYNC_STATUS,
} from '@/lib/sync-protocol'

// ─── POST: Process sync mutations ───────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request)
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const mutations = body.mutations as Array<{
      operationType: string
      resourceType?: string
      resourceId?: string
      clientVersion?: number
      payload: Record<string, unknown>
      idempotencyKey: string
      missionId?: string
      capturedAt?: string
    }>

    if (!Array.isArray(mutations) || mutations.length === 0) {
      return NextResponse.json({ error: 'mutations array is required' }, { status: 400 })
    }

    if (mutations.length > 50) {
      return NextResponse.json({ error: 'Maximum 50 mutations per sync batch' }, { status: 400 })
    }

    const results = []

    for (const mutation of mutations) {
      // Enqueue or process
      const existing = await db.offlineQueue.findUnique({
        where: { idempotencyKey: mutation.idempotencyKey },
      })

      if (existing?.status === SYNC_STATUS.SYNCED) {
        results.push({
          idempotencyKey: mutation.idempotencyKey,
          status: SYNC_STATUS.SYNCED,
          alreadyProcessed: true,
        })
        continue
      }

      // Create queue item if not exists
      if (!existing) {
        await db.offlineQueue.create({
          data: {
            agentId,
            missionId: mutation.missionId,
            operationType: mutation.operationType,
            resourceType: mutation.resourceType,
            resourceId: mutation.resourceId,
            payload: JSON.stringify(mutation.payload),
            idempotencyKey: mutation.idempotencyKey,
            clientVersion: mutation.clientVersion,
            status: SYNC_STATUS.QUEUED,
          },
        })
      }

      // Process the mutation
      const result = await processSyncMutation({
        agentId,
        operationType: mutation.operationType,
        resourceType: mutation.resourceType,
        resourceId: mutation.resourceId,
        clientVersion: mutation.clientVersion,
        payload: mutation.payload,
        idempotencyKey: mutation.idempotencyKey,
        missionId: mutation.missionId,
        capturedAt: mutation.capturedAt,
      })

      results.push({
        idempotencyKey: mutation.idempotencyKey,
        status: result.status,
        success: result.success,
        serverVersion: result.serverVersion,
        error: result.error,
      })
    }

    return NextResponse.json({
      synced: results.filter((r) => r.status === SYNC_STATUS.SYNCED).length,
      failed: results.filter((r) => r.status === SYNC_STATUS.FAILED).length,
      conflicts: results.filter((r) => r.status === SYNC_STATUS.CONFLICT).length,
      results,
    })
  } catch (error) {
    console.error('POST /api/sync error:', error)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}

// ─── GET: Sync queue status ────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request)
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const status = await getSyncQueueStatus(agentId)
    return NextResponse.json(status)
  } catch (error) {
    console.error('GET /api/sync error:', error)
    return NextResponse.json({ error: 'Failed to get sync status' }, { status: 500 })
  }
}
