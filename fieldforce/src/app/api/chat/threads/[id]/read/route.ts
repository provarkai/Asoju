import { NextRequest, NextResponse } from 'next/server';

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
    const adminMatch = cookieHeader.match(/admin_token=([^;]+)/);
    if (adminMatch) token = adminMatch[1];
    if (!token) {
      const custMatch = cookieHeader.match(/cust_token=([^;]+)/);
      if (custMatch) token = custMatch[1];
    }
    if (!token) {
      const agentMatch = cookieHeader.match(/asoju-agent-token=([^;]+)/);
      if (agentMatch) token = agentMatch[1];
    }
  }

  if (!token) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    const issuer = payload.iss;

    if (issuer === 'asoju-admin') {
      return { userId: payload.adminId || payload.userId, role: 'ADMIN', displayName: payload.email || payload.displayName || 'Admin' };
    }
    if (issuer === 'asoju-customer') {
      return { userId: payload.memberId || payload.userId, role: 'CUSTOMER', displayName: payload.email || payload.displayName || 'Customer' };
    }
    if (issuer === 'asoju-agent' || issuer === 'asoju-fieldforce') {
      return { userId: payload.agentId || payload.userId, role: 'AGENT', displayName: payload.phone || payload.displayName || 'Agent' };
    }
    if (payload.userId && payload.role) {
      return { userId: payload.userId, role: payload.role, displayName: payload.displayName || 'User' };
    }
  } catch {
    return null;
  }

  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await extractUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const targetUrl = `http://localhost:3005/api/threads/${id}/read`;

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'X-User-Id': user.userId,
      'X-User-Role': user.role,
      'X-User-Name': user.displayName,
      'Content-Type': 'application/json',
    },
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
