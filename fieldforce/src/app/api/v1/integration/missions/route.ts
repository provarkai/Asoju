// ═══════════════════════════════════════════════════════════════════════════════
// P0.9 — Integration Gateway v1: Create/Get Mission via External API
// POST /api/v1/integration/missions — Create mission from external system
// GET  /api/v1/integration/missions?externalId=xxx — Get mission by external ID
// ═══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  authenticateIntegrationRequest,
  createExternalMapping,
  resolveExternalMission,
  INTEGRATION_SCOPES,
} from '@/lib/integration-gateway'

const API_VERSION = 'v1'

// ─── POST: Create Mission ───────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 1. Authenticate integration request
  const headers = {
    'x-client-id': request.headers.get('x-client-id') ?? undefined,
    'x-timestamp': request.headers.get('x-timestamp') ?? undefined,
    'x-nonce': request.headers.get('x-nonce') ?? undefined,
    'x-signature': request.headers.get('x-signature') ?? undefined,
  }

  const bodyText = await request.text()
  const auth = await authenticateIntegrationRequest(
    headers,
    bodyText,
    'POST',
    `/api/${API_VERSION}/integration/missions`,
    [INTEGRATION_SCOPES.MISSIONS_WRITE]
  )

  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error, code: auth.error_code }, { status: 401 })
  }

  // 2. Parse and validate body
  let body: Record<string, unknown>
  try {
    body = JSON.parse(bodyText)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { externalId, caseData, missionData } = body as {
    externalId?: string
    caseData?: Record<string, unknown>
    missionData?: Record<string, unknown>
  }

  if (!externalId || !caseData || !missionData) {
    return NextResponse.json(
      { error: 'externalId, caseData, and missionData are required' },
      { status: 400 }
    )
  }

  // 3. Check for duplicate (idempotency via externalId)
  const existingMissionId = await resolveExternalMission(auth.clientId!, externalId)
  if (existingMissionId) {
    const existing = await db.mission.findUnique({
      where: { id: existingMissionId },
      include: { case: true },
    })
    return NextResponse.json({
      idempotent: true,
      message: 'Mission already exists for this external ID',
      missionId: existingMissionId,
      caseId: existing?.case?.id,
      externalId,
      workflowState: existing?.workflowState,
    })
  }

  // 4. Create Case + Mission
  try {
    const clientId = auth.clientId!

    const caseRecord = await db.case.create({
      data: {
        caseNumber: `INT-${Date.now().toString(36).toUpperCase()}`,
        title: (caseData.title as string) || 'Integration Case',
        description: caseData.description as string | undefined,
        serviceCode: (caseData.serviceCode as string) || 'TASK_EXECUTION',
        status: 'ACCEPTED',
        priority: (caseData.priority as string) || 'NORMAL',
        source: 'INTEGRATION',
        customerEmail: caseData.customerEmail as string | undefined,
        customerId: caseData.customerId as string | undefined,
        locationSnapshot: caseData.locationSnapshot as string | undefined,
        metadata: JSON.stringify({ integrationClientId: clientId, externalId }),
      },
    })

    const mission = await db.mission.create({
      data: {
        caseId: caseRecord.id,
        agentId: (missionData.agentId as string) || undefined,
        payoutAmount: (missionData.payoutAmount as number) || 0,
        checklistTotal: (missionData.checklistTotal as number) || 0,
        locationSnapshot: missionData.locationSnapshot as string | undefined,
        geofenceRule: missionData.geofenceRule as string | undefined,
        specialInstructions: missionData.specialInstructions as string | undefined,
        scheduledStart: missionData.scheduledStart ? new Date(missionData.scheduledStart as string) : undefined,
        metadata: missionData.metadata as string | undefined,
        workflowState: 'ACCEPTED',
        syncedAt: new Date(),
      },
    })

    // Create external mapping
    await createExternalMapping(clientId, externalId, mission.id)

    // Create audit trail
    await db.adminAuditEvent.create({
      data: {
        action: 'INTEGRATION_MISSION_CREATED',
        entityType: 'Mission',
        entityId: mission.id,
        metadata: JSON.stringify({ clientId, externalId, caseId: caseRecord.id }),
      },
    })

    return NextResponse.json({
      success: true,
      missionId: mission.id,
      caseId: caseRecord.id,
      caseNumber: caseRecord.caseNumber,
      externalId,
      workflowState: mission.workflowState,
    }, { status: 201 })
  } catch (error) {
    console.error('POST /api/v1/integration/missions error:', error)
    return NextResponse.json({ error: 'Failed to create mission' }, { status: 500 })
  }
}

// ─── GET: Get Mission by External ID ────────────────────────────────────────

export async function GET(request: NextRequest) {
  const headers = {
    'x-client-id': request.headers.get('x-client-id') ?? undefined,
    'x-timestamp': request.headers.get('x-timestamp') ?? undefined,
    'x-nonce': request.headers.get('x-nonce') ?? undefined,
    'x-signature': request.headers.get('x-signature') ?? undefined,
  }

  const auth = await authenticateIntegrationRequest(
    headers,
    '', // GET with empty body
    'GET',
    `/api/${API_VERSION}/integration/missions`,
    [INTEGRATION_SCOPES.MISSIONS_READ]
  )

  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error, code: auth.error_code }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const externalId = searchParams.get('externalId')

  if (!externalId) {
    return NextResponse.json({ error: 'externalId query parameter is required' }, { status: 400 })
  }

  const missionId = await resolveExternalMission(auth.clientId!, externalId)
  if (!missionId) {
    return NextResponse.json({ error: 'Mission not found for this external ID' }, { status: 404 })
  }

  const mission = await db.mission.findUnique({
    where: { id: missionId },
    include: {
      case: {
        select: { id: true, caseNumber: true, title: true, status: true },
      },
    },
  })

  if (!mission) {
    return NextResponse.json({ error: 'Mission not found' }, { status: 404 })
  }

  return NextResponse.json({
    externalId,
    missionId: mission.id,
    caseId: mission.case?.id,
    caseNumber: mission.case?.caseNumber,
    workflowState: mission.workflowState,
    checklistProgress: mission.checklistProgress,
    checklistTotal: mission.checklistTotal,
    evidenceCount: mission.evidenceCount,
    payoutAmount: mission.payoutAmount,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
  })
}
