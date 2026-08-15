// ─── POST /api/customer/auth ─────────────────────────────────────────
// Handles customer login, demo login, and logout.
// Query param ?action=login|demo|logout

import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateCustomer,
  createCustomerTokenCookie,
  clearCustomerTokenCookie,
} from '@/lib/customer-auth';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { signCustomerToken } from '@/lib/customer-auth';

// POST /api/customer/auth?action=login
async function handleLogin(request: NextRequest) {
  const { email, password } = await request.json();

  if (!email || !password) {
    return NextResponse.json(
      { error: 'Email and password are required' },
      { status: 400 }
    );
  }

  const result = await authenticateCustomer(email, password);
  if (!result) {
    return NextResponse.json(
      { error: 'Invalid email or password' },
      { status: 401 }
    );
  }

  // Update last login
  await db.customerMember.update({
    where: { id: result.member.id },
    data: { lastLoginAt: new Date() },
  });

  const response = NextResponse.json({
    success: true,
    token: result.token, // Return token in body for client-side header auth
    member: result.member,
    customer: result.customer,
  });

  response.headers.set('Set-Cookie', createCustomerTokenCookie(result.token));
  return response;
}

// POST /api/customer/auth?action=demo
async function handleDemoLogin() {
  const demoEmail = 'chioma.diaspora@yahoo.com';
  const demoPassword = 'member123';

  const result = await authenticateCustomer(demoEmail, demoPassword);
  if (!result) {
    return NextResponse.json(
      { error: 'Demo account not available' },
      { status: 500 }
    );
  }

  // Update last login
  await db.customerMember.update({
    where: { id: result.member.id },
    data: { lastLoginAt: new Date() },
  });

  const response = NextResponse.json({
    success: true,
    token: result.token, // Return token in body for client-side header auth
    member: result.member,
    customer: result.customer,
    isDemo: true,
  });

  response.headers.set('Set-Cookie', createCustomerTokenCookie(result.token));
  return response;
}

// POST /api/customer/auth?action=logout
async function handleLogout() {
  const response = NextResponse.json({ success: true, message: 'Logged out' });
  response.headers.set('Set-Cookie', clearCustomerTokenCookie());
  return response;
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'login';

    switch (action) {
      case 'demo':
        return handleDemoLogin();
      case 'logout':
        return handleLogout();
      case 'login':
      default:
        return handleLogin(request);
    }
  } catch (error) {
    console.error('POST /api/customer/auth error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}
