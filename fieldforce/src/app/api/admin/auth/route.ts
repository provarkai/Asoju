import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import {
  signAdminToken,
  createAdminTokenCookie,
  clearAdminTokenCookie,
} from '@/lib/admin-auth';

// ─── POST: Admin Login ───────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const action = searchParams.get('action') || 'login';

    // Route based on action
    if (action === 'demo') {
      return handleDemoLogin();
    }
    if (action === 'logout') {
      return handleLogout();
    }

    // Default: email + password login
    const body = await request.json().catch(() => ({}));
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const admin = await db.adminUser.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!admin || !admin.isActive) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, admin.password);
    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    // Update last login
    await db.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    const token = await signAdminToken({
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
    });

    const response = NextResponse.json({
      success: true,
      token, // Return token in body for client-side header auth
      admin: {
        id: admin.id,
        email: admin.email,
        displayName: admin.displayName,
        role: admin.role,
        avatarUrl: admin.avatarUrl,
      },
    });

    response.headers.set('Set-Cookie', createAdminTokenCookie(token));
    return response;
  } catch (error) {
    console.error('[ADMIN AUTH] Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ─── Demo Login ──────────────────────────────────────────────────────────

async function handleDemoLogin() {
  const admin = await db.adminUser.findUnique({
    where: { email: 'admin@asoju.ng' },
  });

  if (!admin || !admin.isActive) {
    return NextResponse.json(
      { error: 'Demo admin not available' },
      { status: 404 }
    );
  }

  await db.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  const token = await signAdminToken({
    adminId: admin.id,
    email: admin.email,
    role: admin.role,
  });

  const response = NextResponse.json({
    success: true,
    token, // Return token in body for client-side header auth
    isDemo: true,
    admin: {
      id: admin.id,
      email: admin.email,
      displayName: admin.displayName,
      role: admin.role,
      avatarUrl: admin.avatarUrl,
    },
  });

  response.headers.set('Set-Cookie', createAdminTokenCookie(token));
  return response;
}

// ─── Logout ──────────────────────────────────────────────────────────────

function handleLogout() {
  const response = NextResponse.json({ success: true });
  response.headers.set('Set-Cookie', clearAdminTokenCookie());
  return response;
}
