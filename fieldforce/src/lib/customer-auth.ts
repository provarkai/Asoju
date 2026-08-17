// ─── ASOJU FieldForce — Customer Auth & JWT Utilities ──────────────
// Separate token namespace for customer dashboard (issuer: asoju-customer)

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'fallback-secret-change-in-production'
);
const CUSTOMER_TOKEN_EXPIRY = '7d';

// ─── Customer Token Payload ─────────────────────────────────────────

export interface CustomerTokenPayload {
  customerId: string;
  memberId: string;
  email: string;
  role: string;
}

// ─── Sign / Verify Customer Token ────────────────────────────────────

export async function signCustomerToken(
  payload: CustomerTokenPayload
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(CUSTOMER_TOKEN_EXPIRY)
    .setIssuer('asoju-customer')
    .sign(JWT_SECRET);
}

export async function verifyCustomerToken(
  token: string
): Promise<CustomerTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: 'asoju-customer',
    });
    return payload as unknown as CustomerTokenPayload;
  } catch {
    return null;
  }
}

// ─── Cookie Helpers ──────────────────────────────────────────────────

export function createCustomerTokenCookie(token: string): string {
  return `cust_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;
}

export function clearCustomerTokenCookie(): string {
  return 'cust_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

// ─── Request Auth Helper ─────────────────────────────────────────────

/**
 * Extract and verify the customer token from the cust_token cookie.
 * Returns the CustomerTokenPayload or null if unauthenticated.
 * Use this at the top of every customer API route (except auth).
 */
export async function getCustomerAuth(
  request: Request
): Promise<CustomerTokenPayload | null> {
  // Try Authorization header first (for cross-origin / proxy environments)
  const authHeader = request.headers.get('authorization');
  let token: string | null = null;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    // Fallback to cookie
    const cookieHeader = request.headers.get('cookie') || '';
    const match = cookieHeader.match(/cust_token=([^;]+)/);
    if (match) token = match[1];
  }

  if (!token) return null;

  return verifyCustomerToken(token);
}

// ─── Login Logic ──────────────────────────────────────────────────────

export async function authenticateCustomer(
  email: string,
  password: string
): Promise<{
  member: { id: string; customerId: string; email: string; displayName: string; role: string };
  customer: { id: string; name: string; type: string; logoUrl: string | null };
  token: string;
} | null> {
  const member = await db.customerMember.findUnique({
    where: { email },
    include: { customer: { select: { id: true, name: true, type: true, logoUrl: true, status: true } } },
  });

  if (!member || !member.isActive) return null;
  if (member.customer.status !== 'ACTIVE') return null;

  const valid = await verifyPassword(password, member.password);
  if (!valid) return null;

  const token = await signCustomerToken({
    customerId: member.customerId,
    memberId: member.id,
    email: member.email,
    role: member.role,
  });

  return {
    member: {
      id: member.id,
      customerId: member.customerId,
      email: member.email,
      displayName: member.displayName,
      role: member.role,
    },
    customer: {
      id: member.customer.id,
      name: member.customer.name,
      type: member.customer.type,
      logoUrl: member.customer.logoUrl,
    },
    token,
  };
}

// ─── Customer-Friendly State Mappers ──────────────────────────────────

const MISSION_STATE_LABELS: Record<string, string> = {
  ACCEPTED: 'Agent Assigned',
  EN_ROUTE: 'Agent En Route',
  ON_SITE: 'Agent On Site',
  EXECUTING: 'Work In Progress',
  SUBMITTED: 'Agent Submitted Report',
  QC_PENDING: 'Under Review',
  QC_APPROVED: 'Quality Approved',
  QC_REJECTED: 'Revision Needed',
  COMPLETED: 'Completed',
};

const CASE_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  QUOTED: 'Awaiting Quote Approval',
  PAYMENT_PENDING: 'Payment Pending',
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'In Progress',
  UNDER_REVIEW: 'Under Review',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  PAID: 'Paid',
  PARTIAL: 'Partially Paid',
  REFUNDED: 'Refunded',
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
  CRITICAL: 'Critical',
};

export function mapMissionState(state: string | null | undefined): string {
  if (!state) return 'Not Started';
  return MISSION_STATE_LABELS[state] || state;
}

export function mapCaseStatus(status: string): string {
  return CASE_STATUS_LABELS[status] || status;
}

export function mapPaymentStatus(status: string): string {
  return PAYMENT_STATUS_LABELS[status] || status;
}

export function mapPriority(priority: string): string {
  return PRIORITY_LABELS[priority] || priority;
}
