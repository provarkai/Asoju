// ─── POST /api/auth/login ─────────────────────────────────────────────────
// Validates phone + password, returns JWT cookie.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  verifyPassword,
  signToken,
  createTokenCookie,
} from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { phone, password } = await request.json();

    if (!phone || !password) {
      return NextResponse.json(
        { error: 'Phone and password are required' },
        { status: 400 }
      );
    }

    const agent = await db.agent.findUnique({ where: { phone } });
    if (!agent || !agent.password) {
      return NextResponse.json(
        { error: 'Invalid phone or password' },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, agent.password);
    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid phone or password' },
        { status: 401 }
      );
    }

    const token = await signToken({
      agentId: agent.id,
      phone: agent.phone,
      verificationLevel: agent.verificationLevel,
    });

    const response = NextResponse.json({
      success: true,
      agent: {
        id: agent.id,
        displayName: agent.displayName,
        phone: agent.phone,
        status: agent.status,
        verificationLevel: agent.verificationLevel,
      },
    });

    response.headers.set('Set-Cookie', createTokenCookie(token));
    return response;
  } catch (error) {
    console.error('POST /api/auth/login error:', error);
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    );
  }
}
