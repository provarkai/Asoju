// ─── POST /api/auth/demo ──────────────────────────────────────────────────
// Creates a demo agent (if needed) and returns a JWT cookie.
// This endpoint is NOT protected by middleware.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, signToken, createTokenCookie } from '@/lib/auth';

export async function POST() {
  try {
    let agent = await db.agent.findFirst();

    // Create demo agent if none exists
    if (!agent) {
      // Seed tiers
      const tierCount = await db.agentTier.count();
      if (tierCount === 0) {
        await db.agentTier.createMany({
          data: [
            { name: 'Starter', level: 1, description: 'New agents with 0–4 completed missions.' },
            { name: 'Verified', level: 2, description: 'Identity & field verified agents.' },
            { name: 'Pro', level: 3, description: 'High-performing agents with 85%+ completion rate.' },
            { name: 'Elite', level: 4, description: 'Top-tier specialist agents.' },
          ],
        });
      }
      const tiers = await db.agentTier.findMany({ orderBy: { level: 'asc' } });
      const starterTier = tiers.find((t) => t.name === 'Starter');

      const hashedPw = await hashPassword('demo1234');

      agent = await db.agent.create({
        data: {
          userId: `user-${Date.now()}`,
          phone: '+2348012345678',
          email: 'agent@asoju.ng',
          password: hashedPw,
          displayName: 'Chinedu Okonkwo',
          firstName: 'Chinedu',
          lastName: 'Okonkwo',
          status: 'ACTIVE',
          verificationLevel: 'FIELD_VERIFIED',
          tierId: starterTier?.id,
          idType: 'NIN',
          idDocumentUrl: 'uploads/kyc/demo-nin.jpg',
          selfieUrl: 'uploads/selfies/demo-selfie.jpg',
          bankCode: '057',
          accountNumber: '0123456789',
          accountName: 'Chinedu Okonkwo',
          totalMissionsCompleted: 23,
          totalEarnings: 475000,
          currentBalance: 85000,
          pendingBalance: 18000,
          qcClearedBalance: 67000,
          rating: 4.7,
          ratingCount: 23,
          reliabilityScore: 4.6,
          completionRate: 0.92,
          activatedAt: new Date(),
          lgas: {
            create: [
              { state: 'Lagos', lga: 'Eti-Osa' },
              { state: 'Lagos', lga: 'Ikeja' },
              { state: 'Lagos', lga: 'Lagos Island' },
            ],
          },
        },
      });

      // Create wallet
      await db.walletAccount.create({
        data: {
          agentId: agent.id,
          pendingBalance: agent.pendingBalance,
          qcClearedBalance: agent.qcClearedBalance,
          availableBalance: 0,
          totalEarnings: agent.totalEarnings,
          totalPaid: 0,
        },
      });

      // Audit event
      await db.auditEvent.create({
        data: {
          actorType: 'SYSTEM',
          action: 'DEMO_AGENT_CREATED',
          entityType: 'Agent',
          entityId: agent.id,
          metadata: JSON.stringify({ phone: agent.phone }),
        },
      });
    }

    // Sign JWT
    const token = await signToken({
      agentId: agent.id,
      phone: agent.phone,
      verificationLevel: agent.verificationLevel,
    });

    // Return agent profile + Set-Cookie
    const profile = await db.agent.findUnique({
      where: { id: agent.id },
      include: { lgas: true, tier: true, capabilities: { include: { capability: true } }, certifications: { include: { certification: true } } },
    });

    const response = NextResponse.json({
      token,
      agent: {
        id: profile!.id,
        userId: profile!.userId,
        displayName: profile!.displayName,
        phone: profile!.phone,
        email: profile!.email,
        firstName: profile!.firstName,
        lastName: profile!.lastName,
        avatarUrl: profile!.avatarUrl,
        idType: profile!.idType,
        status: profile!.status,
        verificationLevel: profile!.verificationLevel,
        tierId: profile!.tierId,
        tierName: profile!.tier?.name ?? null,
        reliabilityScore: profile!.reliabilityScore,
        completionRate: profile!.completionRate,
        pendingBalance: profile!.pendingBalance,
        qcClearedBalance: profile!.qcClearedBalance,
        bankCode: profile!.bankCode,
        accountNumber: profile!.accountNumber,
        accountName: profile!.accountName,
        totalMissionsCompleted: profile!.totalMissionsCompleted,
        totalEarnings: profile!.totalEarnings,
        currentBalance: profile!.currentBalance,
        rating: profile!.rating,
        ratingCount: profile!.ratingCount,
        lastActiveAt: profile!.lastActiveAt,
        lgas: profile!.lgas.map((l) => ({ state: l.state, lga: l.lga })),
        capabilities: profile!.capabilities.map((c) => c.capability.code),
        certifications: profile!.certifications.map((c) => c.certification.certificationType),
      },
    });

    response.headers.set('Set-Cookie', createTokenCookie(token));
    return response;
  } catch (error) {
    console.error('POST /api/auth/demo error:', error);
    return NextResponse.json(
      { error: 'Failed to create demo session' },
      { status: 500 }
    );
  }
}
