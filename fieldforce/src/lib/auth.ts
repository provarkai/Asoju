// ─── ASOJU FieldForce — Auth & JWT Utilities ──────────────────────────────
// C2: JWT authentication with phone+password, BOLA/IDOR agent isolation

import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'fallback-secret-change-in-production'
);
const TOKEN_EXPIRY = '7d'; // 7 days for field agents on mobile

// ─── Password Hashing ─────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── JWT Token Operations ─────────────────────────────────────────────────

export interface TokenPayload {
  agentId: string;
  phone: string;
  tierLevel?: number;
  verificationLevel: string;
  role?: string;
}

export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ ...payload, role: payload.role || 'AGENT' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .setIssuer('asoju-fieldforce')
    .sign(JWT_SECRET);
}

export async function verifyToken(
  token: string
): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: 'asoju-fieldforce',
    });
    return payload as unknown as TokenPayload;
  } catch {
    return null;
  }
}

// ─── Request Helpers ───────────────────────────────────────────────────────

/**
 * Extract agentId from the JWT cookie or Authorization header.
 * Used by API route handlers for BOLA/IDOR ownership checks.
 */
export function getAgentIdFromRequest(request: Request): string | null {
  // First try the x-agent-id header (set by middleware)
  const headerAgentId = request.headers.get('x-agent-id');
  if (headerAgentId) return headerAgentId;

  // Fallback: check cookie directly (for routes bypassed by middleware)
  const cookie = request.headers.get('cookie') || '';
  const tokenMatch = cookie.match(/ff_token=([^;]+)/);
  if (!tokenMatch) return null;

  // Can't verify JWT in synchronous context; middleware should have set header
  return null;
}

/**
 * Create a JWT cookie string for Set-Cookie header.
 */
export function createTokenCookie(token: string): string {
  return `ff_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`;
}

/**
 * Create a cleared cookie string for logout.
 */
export function clearTokenCookie(): string {
  return 'ff_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}
