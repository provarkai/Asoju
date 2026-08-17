import { jwtVerify } from 'jose';

const JWT_SECRET = process.env.JWT_SECRET || 'asoju-fieldforce-jwt-secret-key-2024';

export interface AuthUser {
  userId: string;
  role: string; // 'AGENT', 'ADMIN', 'CUSTOMER'
  displayName: string;
}

/**
 * Verify a JWT token and return the authenticated user payload.
 * Supports tokens signed by the main Next.js app (agent, admin, customer issuers).
 */
export async function verifyToken(token: string): Promise<AuthUser> {
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);

    // The main app stores different claim keys depending on issuer
    // Agent: { agentId, role: 'AGENT', phone }
    // Admin: { adminId, role: 'ADMIN', email }
    // Customer: { customerId: memberId, role: 'CUSTOMER', email }
    const userId = payload.agentId || payload.adminId || payload.customerId || payload.memberId || payload.userId || payload.sub;
    let role = (payload.role as string)?.toUpperCase();

    // Fallback: infer role from issuer
    if (!role) {
      const issuer = payload.iss;
      if (issuer === 'asoju-fieldforce' || issuer === 'asoju-agent') role = 'AGENT';
      else if (issuer === 'asoju-admin') role = 'ADMIN';
      else if (issuer === 'asoju-customer') role = 'CUSTOMER';
    }
    const displayName = payload.displayName || payload.name || payload.phone || payload.email || userId;

    if (!userId || !role) {
      throw new Error('Invalid token payload: missing userId or role');
    }

    // Validate role
    const validRoles = ['AGENT', 'ADMIN', 'CUSTOMER'];
    if (!validRoles.includes(role)) {
      throw new Error(`Invalid role: ${role}`);
    }

    console.log(`[AUTH] Token verified for ${role} ${displayName} (${userId})`);
    return { userId: userId as string, role, displayName: displayName as string };
  } catch (err: any) {
    console.error('[AUTH] Token verification failed:', err.message);
    throw new Error('Invalid or expired token');
  }
}

/**
 * Verify auth from BFF headers (trusted internal calls from Next.js).
 * Reads X-User-Id, X-User-Role, X-User-Name headers.
 */
export function verifyBFFHeader(headers: Record<string, string | string[] | undefined>): AuthUser {
  const getUserId = (key: string) => {
    const val = headers[key];
    if (Array.isArray(val)) return val[0];
    return val || null;
  };

  const userId = getUserId('x-user-id');
  const role = getUserId('x-user-role')?.toUpperCase();
  const displayName = getUserId('x-user-name') || userId;

  if (!userId || !role) {
    throw new Error('Missing BFF auth headers (X-User-Id, X-User-Role)');
  }

  const validRoles = ['AGENT', 'ADMIN', 'CUSTOMER'];
  if (!validRoles.includes(role)) {
    throw new Error(`Invalid role in BFF header: ${role}`);
  }

  return { userId, role, displayName: displayName! };
}

/**
 * Extract auth from either BFF headers or Authorization bearer token.
 * Prefers BFF headers; falls back to Bearer token.
 */
export async function authenticateRequest(headers: Record<string, string | string[] | undefined>): Promise<AuthUser> {
  // Try BFF headers first
  const userId = (() => {
    const val = headers['x-user-id'];
    if (Array.isArray(val)) return val[0];
    return val;
  })();

  if (userId) {
    return verifyBFFHeader(headers);
  }

  // Fall back to Bearer token
  const authHeader = (() => {
    const val = headers['authorization'];
    if (Array.isArray(val)) return val[0];
    return val;
  })();

  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('No authentication provided. Send BFF headers or Authorization: Bearer <token>');
  }

  const token = authHeader.slice(7);
  return verifyToken(token);
}
