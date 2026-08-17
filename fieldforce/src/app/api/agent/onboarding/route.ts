import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAgentIdFromRequest } from '@/lib/auth';

// ─── POST /api/agent/onboarding ───────────────────────────────────────
// Submit KYC documents, update verification level, create wallet account
export async function POST(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const idType = formData.get('idType') as string;
    const idDocument = formData.get('idDocument') as File | null;
    const selfie = formData.get('selfie') as File | null;

    if (!idType || !idDocument || !selfie) {
      return NextResponse.json(
        { error: 'Missing required KYC fields: idType, idDocument, selfie' },
        { status: 400 },
      );
    }

    // In production, upload files to S3/cloud storage
    const idDocUrl = `uploads/kyc/${idDocument.name}`;
    const selfieUrl = `uploads/selfies/${selfie.name}`;

    // Find agent by authenticated id
    const agent = await db.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Update agent with KYC info and advance verification level
    const updatedAgent = await db.agent.update({
      where: { id: agent.id },
      data: {
        idType,
        idDocumentUrl: idDocUrl,
        selfieUrl,
        verificationLevel: 'IDENTITY_VERIFIED',
        status: 'IDENTITY_VERIFIED',
      },
    });

    // Create wallet account if not exists
    const existingWallet = await db.walletAccount.findUnique({
      where: { agentId: agent.id },
    });

    if (!existingWallet) {
      await db.walletAccount.create({
        data: {
          agentId: agent.id,
          pendingBalance: 0,
          qcClearedBalance: 0,
          availableBalance: 0,
          totalEarnings: 0,
          totalPaid: 0,
        },
      });
    }

    // Create audit event
    await db.auditEvent.create({
      data: {
        actorType: 'AGENT',
        actorId: agent.id,
        action: 'KYC_SUBMITTED',
        entityType: 'Agent',
        entityId: agent.id,
        metadata: JSON.stringify({ idType, idDocUrl, selfieUrl }),
      },
    });

    return NextResponse.json({
      success: true,
      message: 'KYC submitted successfully. Verification level updated to IDENTITY_VERIFIED.',
      agent: updatedAgent,
    });
  } catch (error) {
    console.error('POST /api/agent/onboarding error:', error);
    return NextResponse.json(
      { error: 'Failed to submit KYC' },
      { status: 500 },
    );
  }
}
