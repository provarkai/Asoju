// ═══════════════════════════════════════════════════════════════════════════════
// P0.5 — Enhanced Evidence Upload with Server-Side Hash Verification
// POST /api/missions/evidence
// ═══════════════════════════════════════════════════════════════════════════════
// Overrides the previous evidence route with P0.5 custody pipeline:
// 1. Validate media type/size
// 2. Compute server-side SHA-256
// 3. Compare with client hash (if provided)
// 4. Create EvidenceItem with custody fields
// 5. Record custody event
// 6. Update mission evidence count

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAgentIdFromRequest } from '@/lib/auth'
import {
  intakeEvidence,
  validateMedia,
  computeSha256,
  recordCustodyEvent,
  CUSTODY_EVENT_TYPES,
} from '@/lib/evidence-custody'
import { verifyMissionOwnership } from '@/lib/bola'

export async function POST(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request)
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const caseId = formData.get('caseId') as string
    const file = formData.get('file') as File
    const checklistId = formData.get('checklistId') as string | null
    const lat = formData.get('lat') as string | null
    const lng = formData.get('lng') as string | null
    const timestamp = formData.get('timestamp') as string | null
    const clientHash = formData.get('clientHash') as string | null
    const idempotencyKey = formData.get('idempotencyKey') as string | null

    if (!caseId || !file) {
      return NextResponse.json(
        { error: 'caseId and file are required' },
        { status: 400 }
      )
    }

    // Verify mission exists and agent owns it (BOLA protection)
    const mission = await db.mission.findUnique({
      where: { caseId },
      select: { id: true, agentId: true, evidenceCount: true, checklistProgress: true, checklistTotal: true, workflowState: true },
    })
    if (!mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 })
    }
    const bolaCheck = verifyMissionOwnership(mission, agentId)
    if (bolaCheck) return bolaCheck

    // Validate media type and size
    const mediaValidation = validateMedia(file.type, file.size)
    if (!mediaValidation.valid) {
      return NextResponse.json({ error: mediaValidation.error }, { status: 400 })
    }

    // Read file buffer for hash computation
    const buffer = Buffer.from(await file.arrayBuffer())

    // Use P0.5 intake pipeline
    const result = await intakeEvidence({
      missionId: mission.id,
      agentId,
      checklistItemId: checklistId ?? undefined,
      fileBuffer: buffer,
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      clientHash: clientHash ?? undefined,
      captureLat: lat ? parseFloat(lat) : undefined,
      captureLng: lng ? parseFloat(lng) : undefined,
      capturedAt: timestamp ? new Date(timestamp) : undefined,
      idempotencyKey: idempotencyKey ?? undefined,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // Update mission evidence count
    const newEvidenceCount = mission.evidenceCount + 1
    const updates: Record<string, unknown> = { evidenceCount: newEvidenceCount }

    if (
      mission.checklistProgress >= mission.checklistTotal &&
      mission.checklistTotal > 0 &&
      mission.workflowState === 'EXECUTING'
    ) {
      updates.workflowState = 'SUBMITTING'
    }

    await db.mission.update({
      where: { caseId },
      data: updates,
    })

    // Create AuditEvent
    await db.auditEvent.create({
      data: {
        actorType: 'AGENT',
        actorId: agentId,
        action: 'EVIDENCE_UPLOADED',
        entityType: 'EvidenceItem',
        entityId: result.evidenceId!,
        metadata: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          checklistId,
          serverHash: result.serverHash,
          hashMatched: result.hashMatched,
        }),
        correlationId: caseId,
      },
    })

    return NextResponse.json({
      success: true,
      evidence: {
        id: result.evidenceId,
        serverHash: result.serverHash,
        hashMatched: result.hashMatched,
        storageKey: result.storageKey,
        status: result.status,
      },
    })
  } catch (error) {
    console.error('POST /api/missions/evidence error:', error)
    return NextResponse.json(
      { error: 'Failed to upload evidence' },
      { status: 500 }
    )
  }
}
