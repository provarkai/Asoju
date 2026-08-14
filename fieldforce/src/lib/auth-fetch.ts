// ─── ASOJU — Unified Auth Fetch Utility ──────────────────────────────────
// Provides token-bearing fetch wrappers for admin and customer portals.
// Falls back to cookie-based auth (for same-origin) while also supporting
// Authorization header auth (for cross-origin / proxy environments).

export type AuthType = 'admin' | 'customer' | 'agent';

const TOKEN_KEYS: Record<AuthType, string> = {
  admin: 'asoju-admin-token',
  customer: 'asoju-customer-token',
  agent: 'asoju-agent-token',
};

const COOKIE_NAMES: Record<AuthType, string> = {
  admin: 'admin_token',
  customer: 'cust_token',
  agent: 'ff_token',
};

/**
 * Store auth token after successful login.
 */
export function setAuthToken(type: AuthType, token: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(TOKEN_KEYS[type], token);
  }
}

/**
 * Clear auth token on logout.
 */
export function clearAuthToken(type: AuthType): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(TOKEN_KEYS[type]);
  }
}

/**
 * Get stored auth token.
 */
export function getAuthToken(type: AuthType): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEYS[type]);
}

/**
 * Auth-aware fetch wrapper. Automatically injects the correct Authorization
 * header based on the URL prefix (/api/admin/* or /api/customer/*).
 */
export function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input.toString();

  // Determine auth type from URL
  let authType: AuthType | null = null;
  if (url.includes('/api/admin/')) authType = 'admin';
  else if (url.includes('/api/customer/')) authType = 'customer';
  else if (url.includes('/api/chat/') || url.includes('/api/agent')) authType = 'agent';

  // Get the token from localStorage
  if (authType) {
    const token = getAuthToken(authType);
    if (token) {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    }
  }

  // No token found — proceed with normal fetch (cookies may still work)
  return fetch(input, init);
}

/**
 * Convenience: fetch with admin token.
 */
export function adminFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return authFetch(input, init);
}

/**
 * Convenience: fetch with customer token.
 */
export function customerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return authFetch(input, init);
}
