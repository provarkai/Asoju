import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAgentIdFromRequest } from '@/lib/auth';
import {
  validateTransition,
  type MissionAction,
  type TransitionResult,
  TERMINAL_STATES,
} from '@/lib/mission-state-machine';
import { sendWorkStartedNotification } from '@/lib/whatsapp-gateway';

// ─── POST /api/missions/transition ──────────────────────────────────────
// Server-authoritative mission state transitions (P0.3)
// All transitions are validated, role-checked, and race-safe

export async function POST(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { caseId, action, reason, idempotencyKey } = body as {
      caseId: string;
      action: MissionAction;
      reason?: string;
      idempotencyKey?: string;
    };

    if (!caseId || !action) {
      return NextResponse.json(
        { error: 'caseId and action are required' },
        { status: 400 }
      );
    }

    // Idempotency check
    if (idempotencyKey) {
      const existing = await db.offlineQueue.findUnique({
        where: { idempotencyKey },
      });
      if (existing?.status === 'SYNCED') {
        return NextResponse.json({
          success: true,
          message: 'Already synced',
          idempotent: true,
        });
      }

      await db.offlineQueue.upsert({
        where: { idempotencyKey },
        create: {
          agentId,
          missionId: caseId,
          operationType: 'MISSION_SUBMIT',
          payload: JSON.stringify(body),
          idempotencyKey,
          status: 'SYNCING',
        },
        update: { status: 'SYNCING' },
      });
    }

    // Get current mission state
    const mission = await db.mission.findUnique({ where: { caseId } });
    if (!mission) {
      return NextResponse.json(
        { error: 'MISSION_NOT_FOUND', message: 'Mission not found' },
        { status: 404 }
      );
    }

    // Verify ownership
    if (mission.agentId !== agentId) {
      return NextResponse.json(
        { error: 'AGENT_OWNERSHIP_REQUIRED', message: 'Agent does not own this mission' },
        { status: 403 }
      );
    }

    // Check terminal state
    if (TERMINAL_STATES.includes(mission.workflowState as typeof TERMINAL_STATES[number])) {
      return NextResponse.json(
        { error: 'INVALID_TRANSITION', message: `Mission is in terminal state: ${mission.workflowState}` },
        { status: 422 }
      );
    }

    // Agent-permitted actions only (P0.3 Role Boundary)
    const agentActions: MissionAction[] = [
      'START_TRAVEL',
      'CHECK_IN',
      'BEGIN_EXECUTION',
      'PREPARE_SUBMIT',
      'SUBMIT',
      'RESUBMIT',
      'ESCALATE',
    ];

    const actorRole = agentActions.includes(action) ? 'AGENT' as const : 'AGENT' as const;

    // Validate transition
    const validation = validateTransition(
      mission.workflowState as any,
      action,
      actorRole,
      { reason }
    );

    if (!validation.success) {
      return NextResponse.json(
        {
          error: validation.error,
          message: validation.message,
          currentState: mission.workflowState,
          requestedAction: action,
        },
        { status: validation.error === 'UNAUTHORIZED_TRANSITION' ? 403 : 422 }
      );
    }

    // Race-safe atomic conditional update
    const updateResult = await db.mission.updateMany({
      where: {
        caseId,
        workflowState: mission.workflowState, // Atomic conditional check
      },
      data: {
        workflowState: validation.newState,
        ...(action === 'ESCALATE' && {
          escalated: true,
          escalationReason: reason || null,
          escalatedAt: new Date(),
        }),
        ...(action === 'SUBMIT' && {
          submittedAt: new Date(),
        }),
        ...(action === 'START_TRAVEL' && {
          acceptedAt: mission.acceptedAt || new Date(),
        }),
      },
    });

    // If no rows affected → concurrent modification (race condition)
    if (updateResult.count === 0) {
      return NextResponse.json(
        {
          error: 'MISSION_STATE_CONFLICT',
          message: 'Mission state was modified concurrently. Please refresh and try again.',
        },
        { status: 409 }
      );
    }

    // Fetch the updated mission
    const updatedMission = await db.mission.findUnique({ where: { caseId } });

    // Create immutable audit event
    await db.auditEvent.create({
      data: {
        actorType: 'AGENT',
        actorId: agentId,
        action: `MISSION_${action}`,
        entityType: 'Mission',
        entityId: mission.id,
        metadata: JSON.stringify({
          from: mission.workflowState,
          to: validation.newState,
          action,
          reason: reason || null,
        }),
        correlationId: caseId,
      },
    });

    // Family Connect milestone 2/3: "agent begins work" — best-effort,
    // must never fail the transition itself if the notification queue
    // hiccups.
    if (action === 'BEGIN_EXECUTION' && validation.newState === 'EXECUTING') {
      try {
        await sendWorkStartedNotification(caseId);
      } catch (notifyError) {
        console.warn(`[Transition] Could not send work-started notification for case ${caseId}:`, notifyError);
      }
    }

    // Auto-transition to QC_REVIEW when SUBMITTED
    if (validation.newState === 'SUBMITTED') {
      await db.mission.update({
        where: { caseId },
        data: { workflowState: 'QC_REVIEW' },
      });

      // Create QC Review record
      const lastQcReview = await db.qcReview.findFirst({
        where: { missionId: mission.id },
        orderBy: { cycleNumber: 'desc' },
      });
      const cycleNumber = (lastQcReview?.cycleNumber || 0) + 1;

      await db.qcReview.create({
        data: {
          missionId: mission.id,
          caseId,
          cycleNumber,
          state: 'PENDING',
        },
      });

      await db.mission.update({
        where: { caseId },
        data: { qcReviewCount: cycleNumber },
      });

      // Audit the auto-transition
      await db.auditEvent.create({
        data: {
          actorType: 'SYSTEM',
          action: 'MISSION_ENTER_QC',
          entityType: 'Mission',
          entityId: mission.id,
          metadata: JSON.stringify({
            from: 'SUBMITTED',
            to: 'QC_REVIEW',
            cycleNumber,
          }),
          correlationId: caseId,
        },
      });

      // Refetch with QC_REVIEW state
      const finalMission = await db.mission.findUnique({ where: { caseId } });
      return NextResponse.json({
        success: true,
        message: `Mission transitioned to QC_REVIEW (cycle #${cycleNumber})`,
        mission: finalMission,
        previousState: mission.workflowState,
        currentState: 'QC_REVIEW',
      });
    }

    // Mark offline queue as synced
    if (idempotencyKey) {
      await db.offlineQueue.update({
        where: { idempotencyKey },
        data: { status: 'SYNCED', syncedAt: new Date() },
      });
    }

    return NextResponse.json({
      success: true,
      message: validation.message,
      mission: updatedMission,
      previousState: mission.workflowState,
      currentState: validation.newState,
    });
  } catch (error) {
    console.error('POST /api/missions/transition error:', error);
    return NextResponse.json(
      { error: 'Failed to process mission transition' },
      { status: 500 }
    );
  }
}
