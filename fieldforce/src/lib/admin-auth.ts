// ─── ASOJU Admin — Auth & JWT Utilities ──────────────────────────────────

import { SignJWT, jwtVerify } from 'jose';
import { verifyPassword } from './auth';
import { db } from './db';
import { cookies } from 'next/headers';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'fallback-secret-change-in-production'
);
const ADMIN_TOKEN_EXPIRY = '24h';

// ─── Admin Token Payload ─────────────────────────────────────────────────

export interface AdminTokenPayload {
  adminId: string;
  email: string;
  role: string;
}

// ─── Admin JWT Operations ────────────────────────────────────────────────

export async function signAdminToken(payload: AdminTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ADMIN_TOKEN_EXPIRY)
    .setIssuer('asoju-admin')
    .sign(JWT_SECRET);
}

export async function verifyAdminToken(
  token: string
): Promise<AdminTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: 'asoju-admin',
    });
    return payload as unknown as AdminTokenPayload;
  } catch {
    return null;
  }
}

// ─── Cookie Helpers ──────────────────────────────────────────────────────

export function createAdminTokenCookie(token: string): string {
  return `admin_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${24 * 60 * 60}`;
}

export function clearAdminTokenCookie(): string {
  return 'admin_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

// ─── Request Auth Helper ─────────────────────────────────────────────────

/**
 * Extract and verify admin token from the admin_token cookie.
 * Returns null if not authenticated.
 */
export async function getAdminFromRequest(request: Request): Promise<AdminTokenPayload | null> {
  // Try Authorization header first (for cross-origin / proxy environments)
  const authHeader = request.headers.get('authorization');
  let token: string | null = null;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    // Fallback to cookie
    const cookieHeader = request.headers.get('cookie') || '';
    const match = cookieHeader.match(/admin_token=([^;]+)/);
    if (match) token = match[1];
  }

  if (!token) return null;

  const payload = await verifyAdminToken(token);
  if (!payload) return null;

  // Verify admin still exists and is active
  const admin = await db.adminUser.findUnique({
    where: { id: payload.adminId },
    select: { id: true, isActive: true },
  });

  if (!admin || !admin.isActive) return null;
  return payload;
}

/**
 * Require admin auth — returns 401 if not authenticated.
 */
export async function requireAdmin(request: Request): Promise<AdminTokenPayload> {
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    throw new AuthError('Unauthorized', 401);
  }
  return admin;
}

// ─── Error Class ─────────────────────────────────────────────────────────

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number = 401) {
    super(message);
    this.status = status;
  }
}
