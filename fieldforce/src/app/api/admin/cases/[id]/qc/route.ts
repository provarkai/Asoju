import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminAuth, withSecurityHeaders, canApproveQC } from '@/lib/bola';
import {
  validateQcTransition,
  evaluateCompletionGate,
  REJECTION_REASONS,
  type QcAction,
  type QcState,
} from '@/lib/qc-state-machine';
import {
  validateTransition,
  type MissionAction,
} from '@/lib/mission-state-machine';
import { postEarnings, postQcEarningsRelease, seedChartOfAccounts } from '@/lib/ledger';

// ─── GET /api/admin/cases/[id]/qc ──────────────────────────────────────
// Get QC review history for a case/mission

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdminAuth(request, ['SUPER_ADMIN', 'OPERATIONS', 'QC']);
    if (admin instanceof NextResponse) return admin;

    const { id } = await params;

    // Find the case and its mission
    const case_ = await db.case.findUnique({
      where: { id },
      include: { mission: true },
    });

    if (!case_?.mission) {
      return NextResponse.json({ error: 'Case or mission not found' }, { status: 404 });
    }

    const mission = case_.mission;

    // Get all QC review cycles for this mission
    const reviews = await db.qcReview.findMany({
      where: { missionId: mission.id },
      orderBy: { cycleNumber: 'desc' },
    });

    // Get evidence and GPS checks for completion gate
    const evidenceCount = await db.evidenceItem.count({
      where: { missionId: mission.id },
    });

    const passedGpsCheck = await db.gpsCheck.findFirst({
      where: {
        missionId: mission.id,
        result: 'PASS',
      },
    });

    const completionGate = {
      qcApproved: reviews[0]?.state === 'APPROVED',
      evidenceValid: evidenceCount > 0,
      gpsCheckinValid: !!passedGpsCheck,
      requiredFieldsComplete:
        mission.checklistTotal > 0 &&
        mission.checklistProgress >= mission.checklistTotal,
      financialReady: true,
    };

    const gateResult = evaluateCompletionGate(completionGate);

    const response = NextResponse.json({
      case: {
        id: case_.id,
        caseNumber: case_.caseNumber,
        title: case_.title,
        status: case_.status,
      },
      mission: {
        id: mission.id,
        workflowState: mission.workflowState,
        checklistProgress: mission.checklistProgress,
        checklistTotal: mission.checklistTotal,
        evidenceCount: mission.evidenceCount,
        qcReviewCount: mission.qcReviewCount,
      },
      reviews,
      currentReview: reviews[0] || null,
      completionGate,
      gateResult,
      validActions: reviews[0]
        ? getValidQcActionsForState(reviews[0].state as QcState)
        : [],
    });
    return withSecurityHeaders(response);

  } catch (error) {
    console.error('GET /api/admin/cases/[id]/qc error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch QC data' },
      { status: 500 }
    );
  }
}

// ─── POST /api/admin/cases/[id]/qc ─────────────────────────────────────
// Perform QC action: START_REVIEW, APPROVE, REJECT, REQUEST_REWORK

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdminAuth(request, ['SUPER_ADMIN', 'OPERATIONS', 'QC']);
    if (admin instanceof NextResponse) return admin;

    // Fetch admin user for displayName
    const adminRecord = await db.adminUser.findUnique({
      where: { id: admin.adminId },
    });

    const { id } = await params;
    const body = await request.json();
    const { action, reason, reworkInstructions, rejectionReasonId } = body as {
      action: QcAction;
      reason?: string;
      reworkInstructions?: string;
      rejectionReasonId?: string;
    };

    if (!action) {
      return NextResponse.json({ error: 'action is required' }, { status: 400 });
    }

    // Find the case and mission
    const case_ = await db.case.findUnique({
      where: { id },
      include: { mission: true },
    });

    if (!case_?.mission) {
      return NextResponse.json({ error: 'Case or mission not found' }, { status: 404 });
    }

    const mission = case_.mission;

    // Get or create current QC review cycle
    let currentReview = await db.qcReview.findFirst({
      where: { missionId: mission.id },
      orderBy: { cycleNumber: 'desc' },
    });

    if (!currentReview) {
      const lastReview = await db.qcReview.findFirst({
        where: { missionId: mission.id },
        orderBy: { cycleNumber: 'desc' },
      });
      const cycleNumber = (lastReview?.cycleNumber || 0) + 1;

      currentReview = await db.qcReview.create({
        data: {
          missionId: mission.id,
          caseId: id,
          cycleNumber,
          state: 'PENDING',
        },
      });
    }

    // Validate QC transition
    const actorRole = (admin.role === 'SUPER_ADMIN' || admin.role === 'OPERATIONS' || admin.role === 'QC')
      ? 'OPERATIONS' as const
      : 'ADMIN' as const;

    const validation = validateQcTransition(
      currentReview.state as QcState,
      action,
      actorRole,
      { reason }
    );

    if (!validation.success) {
      return NextResponse.json(
        {
          error: validation.error,
          message: validation.message,
          currentState: currentReview.state,
          requestedAction: action,
        },
        { status: validation.error === 'UNAUTHORIZED_QC_TRANSITION' ? 403 : 422 }
      );
    }

    // Lookup rejection reason label
    const rejectionReasonLabel = rejectionReasonId
      ? REJECTION_REASONS.find((r) => r.id === rejectionReasonId)?.label || rejectionReasonId
      : null;

    // Update QC review record
    const updatedReview = await db.qcReview.update({
      where: { id: currentReview.id },
      data: {
        state: validation.newState,
        reviewerId: admin.adminId,
        reviewerName: adminRecord?.displayName || admin.email,
        rejectionReason: rejectionReasonLabel || reason || null,
        reworkInstructions: reworkInstructions || null,
        ...(action === 'START_REVIEW' && { startedAt: new Date() }),
        ...(action === 'APPROVE' && { completedAt: new Date() }),
        ...(action === 'REJECT' && { completedAt: new Date() }),
        ...(action === 'REQUEST_REWORK' && { completedAt: new Date() }),
      },
    });

    // Determine the mission state transition based on QC outcome
    let missionAction: MissionAction | null = null;
    let missionNewState: string | null = null;

    if (action === 'APPROVE') {
      // Evaluate completion gate
      const evidenceCount = await db.evidenceItem.count({
        where: { missionId: mission.id },
      });
      const passedGpsCheck = await db.gpsCheck.findFirst({
        where: { missionId: mission.id, result: 'PASS' },
      });

      const gate = {
        qcApproved: true,
        evidenceValid: evidenceCount > 0,
        gpsCheckinValid: !!passedGpsCheck,
        requiredFieldsComplete:
          mission.checklistTotal > 0 &&
          mission.checklistProgress >= mission.checklistTotal,
        financialReady: true,
      };

      const gateResult = evaluateCompletionGate(gate);

      // Save gate results to QC review
      await db.qcReview.update({
        where: { id: updatedReview.id },
        data: { gateResults: JSON.stringify({ gate, gateResult }) },
      });

      if (gateResult.passed) {
        // All gates passed → COMPLETED
        missionAction = 'APPROVE';
        missionNewState = 'COMPLETED';

        await db.mission.update({
          where: { caseId: mission.caseId },
          data: {
            workflowState: 'COMPLETED',
            completedAt: new Date(),
          },
        });

        // Update case status
        await db.case.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            qcStatus: 'APPROVED',
            missionState: 'COMPLETED',
            completedAt: new Date(),
          },
        });

        // P0.8: Post earnings to ledger on mission completion
        await seedChartOfAccounts();
        const earningsResult = await postEarnings({
          missionId: mission.id,
          agentId: mission.agentId,
          payoutAmount: mission.payoutAmount,
          asojuFee: mission.asojuFee,
          netPayout: mission.netPayout,
        });

        // Post QC release (pending → available)
        const releaseResult = await postQcEarningsRelease({
          missionId: mission.id,
          agentId: mission.agentId,
          netPayout: mission.netPayout,
        });

        // Update wallet read model
        if (earningsResult.success) {
          const wallet = await db.walletAccount.findUnique({
            where: { agentId: mission.agentId },
          });
          if (wallet) {
            await db.walletAccount.update({
              where: { id: wallet.id },
              data: {
                totalEarnings: { increment: mission.netPayout },
                availableBalance: { increment: mission.netPayout },
              },
            });
          } else {
            await db.walletAccount.create({
              data: {
                agentId: mission.agentId,
                totalEarnings: mission.netPayout,
                availableBalance: mission.netPayout,
              },
            });
          }

          // Wallet entry for earnings
          if (wallet) {
            await db.walletEntry.create({
              data: {
                agentId: mission.agentId,
                walletAccountId: wallet.id,
                type: 'MISSION_EARNING',
                amount: mission.netPayout,
                description: `Mission earning: ${mission.title} (₦${mission.netPayout.toLocaleString()})`,
                referenceId: mission.id,
              },
            });
          }
        }

        // Update agent totals
        await db.agent.update({
          where: { id: mission.agentId },
          data: {
            totalMissionsCompleted: { increment: 1 },
            totalEarnings: { increment: mission.netPayout },
            currentBalance: { increment: mission.netPayout },
          },
        });

      } else {
        // Gate failed → can still approve but flag issues
        await db.mission.update({
          where: { caseId: mission.caseId },
          data: { workflowState: 'COMPLETED', completedAt: new Date() },
        });
        await db.case.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            qcStatus: 'APPROVED',
            missionState: 'COMPLETED',
            completedAt: new Date(),
          },
        });
      }
    } else if (action === 'REQUEST_REWORK') {
      missionAction = 'REQUEST_REWORK';
      missionNewState = 'REWORK';

      await db.mission.update({
        where: { caseId: mission.caseId },
        data: { workflowState: 'REWORK' },
      });

      await db.case.update({
        where: { id },
        data: {
          qcStatus: 'REJECTED',
          missionState: 'REWORK',
        },
      });
    } else if (action === 'REJECT') {
      missionAction = 'REJECT';
      missionNewState = 'FAILED';

      await db.mission.update({
        where: { caseId: mission.caseId },
        data: { workflowState: 'FAILED' },
      });

      await db.case.update({
        where: { id },
        data: {
          status: 'FAILED',
          qcStatus: 'REJECTED',
          missionState: 'FAILED',
        },
      });
    }

    // Create admin audit event
    await db.adminAuditEvent.create({
      data: {
        adminUserId: admin.adminId,
        actorType: 'ADMIN',
        action: `QC_${action}`,
        entityType: 'QcReview',
        entityId: updatedReview.id,
        metadata: JSON.stringify({
          caseId: id,
          missionId: mission.id,
          cycleNumber: updatedReview.cycleNumber,
          from: currentReview.state,
          to: validation.newState,
          reason: reason || null,
          rejectionReasonId: rejectionReasonId || null,
          missionNewState: missionNewState,
        }),
        correlationId: id,
      },
    });

    // Create case timeline event
    await db.caseTimelineEvent.create({
      data: {
        caseId: id,
        eventType: action === 'APPROVE'
          ? 'QC_APPROVED'
          : action === 'REQUEST_REWORK'
            ? 'QC_REJECTED'
            : action === 'REJECT'
              ? 'QC_HARD_REJECT'
              : 'QC_REVIEW_STARTED',
        title: action === 'APPROVE'
          ? 'Quality Check Passed'
          : action === 'REQUEST_REWORK'
            ? 'Rework Required'
            : action === 'REJECT'
              ? 'Submission Rejected'
              : 'Quality Check Started',
        description: reason || null,
        actorType: 'ADMIN',
        actorName: adminRecord?.displayName || admin.email,
        isCustomerVisible: action === 'APPROVE' || action === 'REQUEST_REWORK',
        metadata: JSON.stringify({
          cycleNumber: updatedReview.cycleNumber,
          missionNewState,
        }),
      },
    });

    const response = NextResponse.json({
      success: true,
      message: `QC ${action} completed successfully`,
      review: updatedReview,
      missionNewState,
    });
    return withSecurityHeaders(response);

  } catch (error) {
    console.error('POST /api/admin/cases/[id]/qc error:', error);
    return NextResponse.json(
      { error: 'Failed to process QC action' },
      { status: 500 }
    );
  }
}

// ─── Helper ──────────────────────────────────────────────────────────────

function getValidQcActionsForState(state: QcState): string[] {
  switch (state) {
    case 'PENDING':
      return ['START_REVIEW'];
    case 'IN_REVIEW':
      return ['APPROVE', 'REJECT', 'REQUEST_REWORK'];
    case 'APPROVED':
    case 'REJECTED':
      return [];
    default:
      return [];
  }
}
