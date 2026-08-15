import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAgentIdFromRequest, signToken, createTokenCookie, hashPassword } from '@/lib/auth';

// Helper: seed AgentTiers if they don't exist
async function ensureTiers() {
  const count = await db.agentTier.count();
  if (count === 0) {
    await db.agentTier.createMany({
      data: [
        { name: 'Starter', level: 1, description: 'New agents with 0–4 completed missions. Standard service catalog access.' },
        { name: 'Verified', level: 2, description: 'Identity & field verified agents. Expanded catalog with higher-value missions.' },
        { name: 'Pro', level: 3, description: 'High-performing agents with 85%+ completion rate. Priority mission access.' },
        { name: 'Elite', level: 4, description: 'Top-tier agents with specialist certifications. Premium missions and bonuses.' },
      ],
    });
  }
  return db.agentTier.findMany({ orderBy: { level: 'asc' } });
}

// ─── GET /api/agent ───────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await ensureTiers();

    const fullAgent = await db.agent.findUnique({
      where: { id: agentId },
      include: {
        lgas: true,
        tier: true,
        capabilities: { include: { capability: true } },
        certifications: { include: { certification: true } },
      },
    });

    if (!fullAgent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const profile = {
      id: fullAgent.id,
      userId: fullAgent.userId,
      displayName: fullAgent.displayName,
      phone: fullAgent.phone,
      email: fullAgent.email,
      firstName: fullAgent.firstName,
      lastName: fullAgent.lastName,
      avatarUrl: fullAgent.avatarUrl,
      idType: fullAgent.idType,
      idDocumentUrl: fullAgent.idDocumentUrl,
      selfieUrl: fullAgent.selfieUrl,
      status: fullAgent.status,
      verificationLevel: fullAgent.verificationLevel,
      tierId: fullAgent.tierId,
      tierName: fullAgent.tier?.name ?? null,
      reliabilityScore: fullAgent.reliabilityScore,
      completionRate: fullAgent.completionRate,
      pendingBalance: fullAgent.pendingBalance,
      qcClearedBalance: fullAgent.qcClearedBalance,
      bankCode: fullAgent.bankCode,
      accountNumber: fullAgent.accountNumber,
      accountName: fullAgent.accountName,
      totalMissionsCompleted: fullAgent.totalMissionsCompleted,
      totalEarnings: fullAgent.totalEarnings,
      currentBalance: fullAgent.currentBalance,
      rating: fullAgent.rating,
      ratingCount: fullAgent.ratingCount,
      lastActiveAt: fullAgent.lastActiveAt,
      lgas: fullAgent.lgas.map((l) => ({ state: l.state, lga: l.lga })),
      capabilities: fullAgent.capabilities.map((c) => c.capability.code),
      certifications: fullAgent.certifications.map((c) => c.certification.certificationType),
    };

    return NextResponse.json(profile);
  } catch (error) {
    console.error('GET /api/agent error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agent profile' },
      { status: 500 },
    );
  }
}

// ─── POST /api/agent ────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      firstName,
      lastName,
      phone,
      email,
      password,
      bankCode,
      accountNumber,
      accountName,
    } = body;

    if (!firstName || !lastName || !phone || !password) {
      return NextResponse.json(
        { error: 'Missing required fields: firstName, lastName, phone, password' },
        { status: 400 },
      );
    }

    const existing = await db.agent.findUnique({ where: { phone } });
    if (existing) {
      return NextResponse.json(
        { error: 'Phone number already registered' },
        { status: 409 },
      );
    }

    const tiers = await ensureTiers();
    const starterTier = tiers.find((t) => t.name === 'Starter');

    const hashedPassword = await hashPassword(password);

    const agent = await db.agent.create({
      data: {
        userId: `user-${Date.now()}`,
        firstName,
        lastName,
        displayName: `${firstName} ${lastName}`,
        phone,
        email: email || null,
        password: hashedPassword,
        bankCode: bankCode || null,
        accountNumber: accountNumber || null,
        accountName: accountName || null,
        status: 'APPLIED',
        verificationLevel: 'APPLICANT',
        tierId: starterTier?.id,
      },
    });

    // Issue JWT and set cookie
    const token = await signToken({
      agentId: agent.id,
      phone: agent.phone,
      verificationLevel: agent.verificationLevel,
    });

    return NextResponse.json(agent, {
      status: 201,
      headers: { 'Set-Cookie': createTokenCookie(token) },
    });
  } catch (error) {
    console.error('POST /api/agent error:', error);
    return NextResponse.json(
      { error: 'Failed to create agent' },
      { status: 500 },
    );
  }
}

// ─── PATCH /api/agent ───────────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { lgas, ...updates } = body;

    const agent = await db.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    if (lgas && Array.isArray(lgas)) {
      await db.agentLga.deleteMany({ where: { agentId: agent.id } });
      await db.agentLga.createMany({
        data: lgas.map((lga: { state: string; lga: string }) => ({
          agentId: agent.id,
          state: lga.state,
          lga: lga.lga,
        })),
      });
    }

    if (Object.keys(updates).length > 0) {
      await db.agent.update({
        where: { id: agent.id },
        data: updates,
      });
    }

    const updated = await db.agent.findUnique({
      where: { id: agent.id },
      include: { lgas: true, tier: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/agent error:', error);
    return NextResponse.json(
      { error: 'Failed to update agent' },
      { status: 500 },
    );
  }
}
