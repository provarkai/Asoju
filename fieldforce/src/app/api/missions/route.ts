import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAgentIdFromRequest } from '@/lib/auth';
import {
  validateTransition,
  TERMINAL_STATES,
} from '@/lib/mission-state-machine';

// ─── GET /api/missions ────────────────────────────────────────────────
// Fetch agent's missions
export async function GET(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const missions = await db.mission.findMany({
      where: { agentId },
      orderBy: { assignedAt: 'desc' },
    });

    return NextResponse.json(missions);
  } catch (error) {
    console.error('GET /api/missions error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch missions' },
      { status: 500 },
    );
  }
}

// ─── PATCH /api/missions ──────────────────────────────────────────────
// Update checklist progress only (state transitions handled by /transition endpoint)
export async function PATCH(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { caseId, checklistId, completed, value, photoUrl, idempotencyKey } = body;

    if (!caseId) {
      return NextResponse.json({ error: 'caseId required' }, { status: 400 });
    }

    // Idempotency check
    if (idempotencyKey) {
      const existing = await db.offlineQueue.findUnique({
        where: { idempotencyKey },
      });
      if (existing?.status === 'SYNCED') {
        return NextResponse.json({ success: true, message: 'Already synced', idempotent: true });
      }

      await db.offlineQueue.upsert({
        where: { idempotencyKey },
        create: {
          agentId,
          missionId: caseId,
          operationType: 'CHECKLIST_UPDATE',
          payload: JSON.stringify(body),
          idempotencyKey,
          status: 'SYNCING',
        },
        update: { status: 'SYNCING' },
      });
    }

    // Get mission and verify ownership
    const mission = await db.mission.findUnique({ where: { caseId } });
    if (!mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }
    if (mission.agentId !== agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Only allow checklist updates for active mission states
    const activeStates = ['ON_SITE', 'EXECUTING', 'SUBMITTING', 'REWORK', 'PAUSED', 'ESCALATED'];
    if (!activeStates.includes(mission.workflowState)) {
      return NextResponse.json(
        {
          error: 'INVALID_STATE_FOR_CHECKLIST',
          message: `Cannot update checklist in state: ${mission.workflowState}`,
          currentState: mission.workflowState,
        },
        { status: 422 },
      );
    }

    // Parse scope snapshot and update checklist
    let scope: { objectives: string[]; checklist: { id: string; completed: boolean; value?: string; photoUrl?: string }[]; exclusions: string[] } = { objectives: [], checklist: [], exclusions: [] };
    try {
      scope = JSON.parse(mission.scopeSnapshot || '{}');
    } catch { /* ignore */ }

    if (checklistId && scope.checklist) {
      const item = scope.checklist.find((c) => c.id === checklistId);
      if (item) {
        item.completed = completed;
        if (value) item.value = value;
        if (photoUrl) item.photoUrl = photoUrl;
      }
    }

    // Calculate progress
    const totalChecklist = scope.checklist?.length || 0;
    const completedCount = scope.checklist?.filter((c: { completed: boolean }) => c.completed).length || 0;

    // Only update checklist data, NOT the workflow state
    // State transitions are handled by /api/missions/transition (P0.3)
    const updated = await db.mission.update({
      where: { caseId },
      data: {
        scopeSnapshot: JSON.stringify(scope),
        checklistProgress: completedCount,
        checklistTotal: totalChecklist,
      },
    });

    // Create AuditEvent
    await db.auditEvent.create({
      data: {
        actorType: 'AGENT',
        actorId: agentId,
        action: 'CHECKLIST_UPDATED',
        entityType: 'Mission',
        entityId: mission.id,
        metadata: JSON.stringify({ checklistId, completed, completedCount, totalChecklist }),
        correlationId: caseId,
      },
    });

    // Mark offline queue as synced
    if (idempotencyKey) {
      await db.offlineQueue.update({
        where: { idempotencyKey },
        data: { status: 'SYNCED', syncedAt: new Date() },
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/missions error:', error);
    return NextResponse.json(
      { error: 'Failed to update mission' },
      { status: 500 },
    );
  }
}

// ─── PUT /api/missions ────────────────────────────────────────────────
// Escalate a mission (state transition via P0.3 state machine)
// NOTE: Submit action should use POST /api/missions/transition instead
export async function PUT(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, caseId, reason, escalationType, severity } = body;

    // Verify mission belongs to agent
    const existingMission = await db.mission.findUnique({ where: { caseId } });
    if (!existingMission) {
      return NextResponse.json({ error: 'MISSION_NOT_FOUND' }, { status: 404 });
    }
    if (existingMission.agentId !== agentId) {
      return NextResponse.json({ error: 'AGENT_OWNERSHIP_REQUIRED' }, { status: 403 });
    }

    // Only handle escalation here; submit uses /transition endpoint
    if (action === 'escalate' && caseId && reason) {
      // Validate via P0.3 state machine
      const validation = validateTransition(
        existingMission.workflowState as any,
        'ESCALATE',
        'AGENT',
        { reason }
      );

      if (!validation.success) {
        return NextResponse.json(
          {
            error: validation.error,
            message: validation.message,
            currentState: existingMission.workflowState,
          },
          { status: validation.error === 'UNAUTHORIZED_TRANSITION' ? 403 : 422 },
        );
      }

      // Race-safe atomic update
      const updateResult = await db.mission.updateMany({
        where: {
          caseId,
          workflowState: existingMission.workflowState,
        },
        data: {
          escalated: true,
          escalationReason: reason,
          escalationType: escalationType || 'OPERATIONAL',
          escalationSeverity: severity || 'MEDIUM',
          workflowState: validation.newState,
          escalatedAt: new Date(),
        },
      });

      if (updateResult.count === 0) {
        return NextResponse.json(
          { error: 'MISSION_STATE_CONFLICT', message: 'Concurrent modification detected' },
          { status: 409 },
        );
      }

      const updated = await db.mission.findUnique({ where: { caseId } });

      // Create AuditEvent
      await db.auditEvent.create({
        data: {
          actorType: 'AGENT',
          actorId: agentId,
          action: 'MISSION_ESCALATED',
          entityType: 'Mission',
          entityId: updated!.id,
          metadata: JSON.stringify({ reason, escalationType, severity }),
          correlationId: caseId,
        },
      });

      return NextResponse.json(updated);
    }

    if (action === 'submit' && caseId) {
      // Redirect to transition endpoint pattern
      const validation = validateTransition(
        existingMission.workflowState as any,
        'SUBMIT',
        'AGENT',
      );

      if (!validation.success) {
        return NextResponse.json(
          {
            error: validation.error,
            message: validation.message,
            currentState: existingMission.workflowState,
          },
          { status: validation.error === 'UNAUTHORIZED_TRANSITION' ? 403 : 422 },
        );
      }

      // Race-safe atomic update
      const updateResult = await db.mission.updateMany({
        where: {
          caseId,
          workflowState: existingMission.workflowState,
        },
        data: {
          workflowState: validation.newState,
          submittedAt: new Date(),
        },
      });

      if (updateResult.count === 0) {
        return NextResponse.json(
          { error: 'MISSION_STATE_CONFLICT', message: 'Concurrent modification detected' },
          { status: 409 },
        );
      }

      const updated = await db.mission.findUnique({ where: { caseId } });

      // Auto-transition to QC_REVIEW
      if (updated && validation.newState === 'SUBMITTED') {
        await db.mission.update({
          where: { caseId },
          data: { workflowState: 'QC_REVIEW' },
        });

        // Create QC Review record
        const lastQcReview = await db.qcReview.findFirst({
          where: { missionId: updated.id },
          orderBy: { cycleNumber: 'desc' },
        });
        const cycleNumber = (lastQcReview?.cycleNumber || 0) + 1;

        await db.qcReview.create({
          data: {
            missionId: updated.id,
            caseId,
            cycleNumber,
            state: 'PENDING',
          },
        });

        await db.mission.update({
          where: { caseId },
          data: { qcReviewCount: cycleNumber },
        });

        const finalMission = await db.mission.findUnique({ where: { caseId } });

        // Audit events
        await db.auditEvent.create({
          data: {
            actorType: 'AGENT',
            actorId: agentId,
            action: 'MISSION_SUBMITTED',
            entityType: 'Mission',
            entityId: updated.id,
            metadata: JSON.stringify({ submittedAt: new Date().toISOString() }),
            correlationId: caseId,
          },
        });

        await db.auditEvent.create({
          data: {
            actorType: 'SYSTEM',
            action: 'MISSION_ENTER_QC',
            entityType: 'Mission',
            entityId: updated.id,
            metadata: JSON.stringify({ from: 'SUBMITTED', to: 'QC_REVIEW', cycleNumber }),
            correlationId: caseId,
          },
        });

        return NextResponse.json({
          ...finalMission,
          qcCycleNumber: cycleNumber,
        });
      }

      // Create AuditEvent
      await db.auditEvent.create({
        data: {
          actorType: 'AGENT',
          actorId: agentId,
          action: 'MISSION_SUBMITTED',
          entityType: 'Mission',
          entityId: updated!.id,
          metadata: JSON.stringify({ submittedAt: new Date().toISOString() }),
          correlationId: caseId,
        },
      });

      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('PUT /api/missions error:', error);
    return NextResponse.json(
      { error: 'Failed to update mission' },
      { status: 500 },
    );
  }
}
