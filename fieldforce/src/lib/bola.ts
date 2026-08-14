// ─── ASOJU FieldForce — P0.2 BOLA/IDOR Protection Library ──────────────────
// Broken Object Level Authorization / Insecure Direct Object Reference hardening
//
// Every protected endpoint MUST use these helpers to verify resource ownership.
// No endpoint should trust client-supplied owner IDs.
// Foreign resource IDs fail consistently without data leakage.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAgentIdFromRequest } from '@/lib/auth';
import { getAdminFromRequest } from '@/lib/admin-auth';
import { getCustomerAuth } from '@/lib/customer-auth';

// ─── Error Response Helpers ─────────────────────────────────────────────

/** Returns a 401 Unauthorized response */
export function unauthorized(message = 'Authentication required') {
  return NextResponse.json(
    { error: message, code: 'UNAUTHENTICATED' },
    { status: 401 }
  );
}

/** Returns a 403 Forbidden response */
export function forbidden(message = 'Access denied') {
  return NextResponse.json(
    { error: message, code: 'FORBIDDEN' },
    { status: 403 }
  );
}

/** Returns a 404 Not Found response (no data leakage) */
export function notFound(message = 'Resource not found') {
  return NextResponse.json(
    { error: message, code: 'NOT_FOUND' },
    { status: 404 }
  );
}

// ─── Agent Auth & Ownership ─────────────────────────────────────────────

export interface AgentAuth {
  agentId: string;
}

/**
 * Authenticate and extract agent identity from request.
 * Returns null if not authenticated (caller should return 401).
 */
export function requireAgentAuth(request: Request): AgentAuth | null {
  const agentId = getAgentIdFromRequest(request);
  if (!agentId) return null;
  return { agentId };
}

/**
 * Verify that a mission belongs to the authenticated agent.
 * Returns mission if authorized, null if not found or not owned.
 * BOLA: Never trusts client-supplied agentId — always uses JWT-derived ID.
 */
export async function verifyMissionOwnership(
  request: Request,
  missionIdOrCaseId: string
): Promise<{ mission: any; auth: AgentAuth } | NextResponse> {
  const auth = requireAgentAuth(request);
  if (!auth) return unauthorized();

  // Try finding by caseId first (most common), then by id
  const mission = await db.mission.findFirst({
    where: {
      OR: [
        { id: missionIdOrCaseId },
        { caseId: missionIdOrCaseId },
      ],
    },
  });

  if (!mission) return notFound('Mission not found');
  if (mission.agentId !== auth.agentId) return forbidden('You do not own this mission');

  return { mission, auth };
}

/**
 * Verify that a payout belongs to the authenticated agent.
 * Agents cannot approve/release their own payouts.
 */
export async function verifyPayoutOwnership(
  request: Request,
  payoutId: string
): Promise<{ payout: any; auth: AgentAuth } | NextResponse> {
  const auth = requireAgentAuth(request);
  if (!auth) return unauthorized();

  const payout = await db.payout.findUnique({ where: { id: payoutId } });
  if (!payout) return notFound('Payout not found');
  if (payout.agentId !== auth.agentId) return forbidden('You do not own this payout');

  return { payout, auth };
}

/**
 * Verify that GPS check belongs to the authenticated agent.
 */
export async function verifyGpsCheckOwnership(
  request: Request,
  checkId: string
): Promise<{ check: any; auth: AgentAuth } | NextResponse> {
  const auth = requireAgentAuth(request);
  if (!auth) return unauthorized();

  const check = await db.gpsCheck.findUnique({ where: { id: checkId } });
  if (!check) return notFound('GPS check not found');
  if (check.agentId !== auth.agentId) return forbidden('You do not own this check');

  return { check, auth };
}

/**
 * Verify that evidence item belongs to the authenticated agent.
 */
export async function verifyEvidenceOwnership(
  request: Request,
  evidenceId: string
): Promise<{ evidence: any; auth: AgentAuth } | NextResponse> {
  const auth = requireAgentAuth(request);
  if (!auth) return unauthorized();

  const evidence = await db.evidenceItem.findUnique({ where: { id: evidenceId } });
  if (!evidence) return notFound('Evidence not found');
  if (evidence.agentId !== auth.agentId) return forbidden('You do not own this evidence');

  return { evidence, auth };
}

// ─── Customer Auth & Ownership ───────────────────────────────────────────

export interface CustomerAuth {
  customerId: string;
  memberId: string;
  email: string;
  role: string;
}

/**
 * Authenticate and extract customer identity from request.
 * Returns null if not authenticated (caller should return 401).
 */
export async function requireCustomerAuth(
  request: Request
): Promise<CustomerAuth | null> {
  return getCustomerAuth(request);
}

/**
 * Verify that a case belongs to the authenticated customer.
 * Returns case if authorized, 404 if not found or not owned.
 * BOLA: Never trusts client-supplied customerId — always uses JWT-derived ID.
 */
export async function verifyCaseOwnership(
  request: Request,
  caseId: string
): Promise<{ caseData: any; auth: CustomerAuth } | NextResponse> {
  const auth = await requireCustomerAuth(request);
  if (!auth) return unauthorized();

  const caseData = await db.case.findUnique({
    where: { id: caseId },
    select: { id: true, customerId: true },
  });

  if (!caseData || caseData.customerId !== auth.customerId) {
    return notFound('Case not found');
  }

  return { caseData, auth };
}

// ─── Admin Auth & RBAC ──────────────────────────────────────────────────

export interface AdminAuth {
  adminId: string;
  email: string;
  role: string;
}

const ADMIN_ROLES = {
  SUPER_ADMIN: ['SUPER_ADMIN'],
  OPERATIONS: ['SUPER_ADMIN', 'OPERATIONS'],
  FINANCE: ['SUPER_ADMIN', 'FINANCE'],
  QC: ['SUPER_ADMIN', 'OPERATIONS', 'QC'],
  SUPPORT: ['SUPER_ADMIN', 'OPERATIONS', 'SUPPORT'],
  ANALYST: ['SUPER_ADMIN', 'OPERATIONS', 'ANALYST'],
} as const;

type RoleCategory = keyof typeof ADMIN_ROLES;

/**
 * Authenticate admin and optionally check role authorization.
 * Returns admin auth if authorized, or NextResponse error.
 */
export async function requireAdminAuth(
  request: Request,
  allowedRoles?: string[]
): Promise<AdminAuth | NextResponse> {
  const admin = await getAdminFromRequest(request);
  if (!admin) return unauthorized('Admin authentication required');

  if (allowedRoles && allowedRoles.length > 0) {
    if (!allowedRoles.includes(admin.role)) {
      return forbidden(`Role '${admin.role}' is not authorized for this action`);
    }
  }

  return { adminId: admin.adminId, email: admin.email, role: admin.role };
}

/**
 * Get admin auth or null (non-throwing version).
 */
export async function getAdminAuth(request: Request): Promise<AdminAuth | null> {
  const admin = await getAdminFromRequest(request);
  if (!admin) return null;
  return { adminId: admin.adminId, email: admin.email, role: admin.role };
}

// ─── P0.2 Security Rules ────────────────────────────────────────────────

/**
 * Enforce that agent cannot self-approve QC.
 * Only ADMIN/OPERATIONS can approve QC reviews.
 */
export function canApproveQC(role: string): boolean {
  return ['SUPER_ADMIN', 'OPERATIONS', 'QC'].includes(role);
}

/**
 * Enforce that agent cannot approve/release their own payout.
 * Payout releases require FINANCE or SUPER_ADMIN role.
 */
export function canReleasePayout(role: string): boolean {
  return ['SUPER_ADMIN', 'FINANCE'].includes(role);
}

/**
 * Check if an admin role can access finance operations.
 */
export function canAccessFinance(role: string): boolean {
  return ['SUPER_ADMIN', 'FINANCE', 'OPERATIONS'].includes(role);
}

/**
 * Security response headers for all API responses.
 * Add these headers to every API response.
 */
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-store',
} as const;

/**
 * Apply security headers to a NextResponse.
 */
export function withSecurityHeaders(response: NextResponse): NextResponse {
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}
