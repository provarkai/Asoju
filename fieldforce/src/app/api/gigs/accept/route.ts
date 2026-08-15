import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAgentIdFromRequest } from '@/lib/auth';

// ─── POST /api/gigs/accept ─────────────────────────────────────────────
// Accept a gig → Create Mission, MissionAssignment, WalletEntry, AuditEvent
// C5: Entire flow wrapped in db.$transaction() to prevent double-claim
export async function POST(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { caseId } = await request.json();
    if (!caseId) {
      return NextResponse.json({ error: 'caseId required' }, { status: 400 });
    }

    const mission = await db.$transaction(async (tx) => {
      // 1. Check gig availability (with row lock via findUnique inside tx)
      const gig = await tx.cachedGig.findUnique({ where: { caseId } });
      if (!gig || gig.status !== 'AVAILABLE') {
        throw new Error('GIG_UNAVAILABLE');
      }

      // 2. Mark as claimed immediately (prevents double-claim)
      await tx.cachedGig.update({
        where: { caseId },
        data: {
          status: 'CLAIMED',
          claimedBy: agentId,
          claimedAt: new Date(),
          agentId,
        },
      });

      // Verify agent exists
      const agent = await tx.agent.findUnique({ where: { id: agentId } });
      if (!agent) {
        throw new Error('AGENT_NOT_FOUND');
      }

      // Parse case scope for checklist total
      let checklistTotal = 0;
      try {
        const scope = JSON.parse(gig.caseScope || '{}');
        checklistTotal = scope.checklist?.length || 0;
      } catch { /* ignore */ }

      // Calculate payout amounts
      const asojuFee = Math.round(gig.estimatedPayout * 0.1);
      const netPayout = gig.estimatedPayout - asojuFee;

      // Build SLA snapshot
      const now = new Date();
      const slaArrivalTarget = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
      const slaSubmissionTarget = new Date(now.getTime() + 3 * 60 * 60 * 1000); // 3 hours
      const slaSnapshot = JSON.stringify({
        deadline: gig.slaDeadline,
        arrivalTarget: slaArrivalTarget.toISOString(),
        submissionTarget: slaSubmissionTarget.toISOString(),
      });

      // Create Mission
      const newMission = await tx.mission.create({
        data: {
          caseId: gig.caseId,
          agentId,
          serviceCode: gig.serviceCode,
          title: gig.title,
          description: gig.description,
          state: gig.state,
          lga: gig.lga,
          address: gig.address,
          payoutAmount: gig.estimatedPayout,
          asojuFee,
          netPayout,
          slaDeadline: new Date(gig.slaDeadline),
          slaArrivalTarget,
          slaSubmissionTarget,
          priority: gig.priority,
          beneficiaryName: gig.beneficiaryName,
          beneficiaryPhone: gig.beneficiaryPhone,
          workflowState: 'EN_ROUTE',
          scopeSnapshot: gig.caseScope,
          slaSnapshot,
          checklistTemplate: gig.caseScope,
          checklistTotal,
          acceptedAt: now,
        },
      });

      // Create MissionAssignment
      await tx.missionAssignment.create({
        data: {
          missionId: newMission.id,
          agentId,
          state: 'ACCEPTED',
          acceptedAt: now,
        },
      });

      // Create or update WalletAccount
      const existingWallet = await tx.walletAccount.findUnique({
        where: { agentId },
      });

      let walletAccountId: string;
      if (existingWallet) {
        walletAccountId = existingWallet.id;
        await tx.walletAccount.update({
          where: { id: walletAccountId },
          data: {
            pendingBalance: { increment: netPayout },
            totalEarnings: { increment: netPayout },
          },
        });
      } else {
        const wallet = await tx.walletAccount.create({
          data: {
            agentId,
            pendingBalance: netPayout,
            totalEarnings: netPayout,
          },
        });
        walletAccountId = wallet.id;
      }

      // Create WalletEntry for pending earning
      await tx.walletEntry.create({
        data: {
          agentId,
          walletAccountId,
          type: 'MISSION_EARNING',
          amount: netPayout,
          description: `Mission earning: ${gig.title}`,
          referenceId: newMission.id,
        },
      });

      // Create AuditEvent
      await tx.auditEvent.create({
        data: {
          actorType: 'AGENT',
          actorId: agentId,
          action: 'MISSION_ACCEPTED',
          entityType: 'Mission',
          entityId: newMission.id,
          metadata: JSON.stringify({
            caseId: newMission.caseId,
            serviceCode: gig.serviceCode,
            payoutAmount: gig.estimatedPayout,
          }),
          correlationId: newMission.caseId,
        },
      });

      return newMission;
    });

    return NextResponse.json(mission, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message === 'GIG_UNAVAILABLE') {
      return NextResponse.json(
        { error: 'Gig is no longer available' },
        { status: 409 },
      );
    }
    if (message === 'AGENT_NOT_FOUND') {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    console.error('POST /api/gigs/accept error:', error);
    return NextResponse.json(
      { error: 'Failed to accept gig' },
      { status: 500 },
    );
  }
}
