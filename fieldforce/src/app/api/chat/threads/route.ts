import { NextRequest, NextResponse } from 'next/server';

// ─── Helper: Extract user identity from any portal token ──────────────
// Supports admin_token, cust_token, and agent tokens (from auth-fetch / Authorization header)

interface ChatUser {
  userId: string;
  role: string;
  displayName: string;
}

async function extractUser(request: NextRequest): Promise<ChatUser | null> {
  const authHeader = request.headers.get('authorization');
  let token: string | null = null;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    const cookieHeader = request.headers.get('cookie') || '';
    // Try admin token
    const adminMatch = cookieHeader.match(/admin_token=([^;]+)/);
    if (adminMatch) {
      token = adminMatch[1];
    }
    // Try customer token
    if (!token) {
      const custMatch = cookieHeader.match(/cust_token=([^;]+)/);
      if (custMatch) token = custMatch[1];
    }
    // Try agent token (asoju-agent-token cookie)
    if (!token) {
      const agentMatch = cookieHeader.match(/asoju-agent-token=([^;]+)/);
      if (agentMatch) token = agentMatch[1];
    }
  }

  if (!token) return null;

  // Try to decode JWT without verification to extract payload
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));

    const issuer = payload.iss;

    if (issuer === 'asoju-admin') {
      return {
        userId: payload.adminId || payload.userId,
        role: 'ADMIN',
        displayName: payload.email || payload.displayName || 'Admin',
      };
    }
    if (issuer === 'asoju-customer') {
      return {
        userId: payload.memberId || payload.userId,
        role: 'CUSTOMER',
        displayName: payload.email || payload.displayName || 'Customer',
      };
    }
    if (issuer === 'asoju-agent' || issuer === 'asoju-fieldforce') {
      return {
        userId: payload.agentId || payload.userId,
        role: 'AGENT',
        displayName: payload.phone || payload.displayName || 'Agent',
      };
    }

    // Fallback: check for common fields
    if (payload.userId && payload.role) {
      return {
        userId: payload.userId,
        role: payload.role,
        displayName: payload.displayName || payload.email || payload.phone || 'User',
      };
    }
  } catch {
    return null;
  }

  return null;
}

// ─── Helper: Forward request to chat-service ──────────────────────────

async function forwardRequest(
  request: NextRequest,
  path: string,
  user: ChatUser,
  init?: { method?: string; body?: BodyInit },
) {
  const targetUrl = `http://localhost:3005${path}`;
  const headers: Record<string, string> = {
    'X-User-Id': user.userId,
    'X-User-Role': user.role,
    'X-User-Name': user.displayName,
    'Content-Type': 'application/json',
  };

  const res = await fetch(targetUrl, {
    method: init?.method || request.method,
    headers,
    body: init?.body || (request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

// ─── GET /api/chat/threads — List threads ───────────────────────────────

export async function GET(request: NextRequest) {
  const user = await extractUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return forwardRequest(request, '/api/threads', user);
}

// ─── POST /api/chat/threads — Create thread ────────────────────────────

export async function POST(request: NextRequest) {
  const user = await extractUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.text();
  return forwardRequest(request, '/api/threads', user, {
    method: 'POST',
    body,
  });
}
