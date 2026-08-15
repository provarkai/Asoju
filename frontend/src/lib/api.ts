const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const ACCESS_TOKEN_KEY = 'asoju_access_token';
const REFRESH_TOKEN_KEY = 'asoju_refresh_token';
const USER_KEY = 'asoju_user';

export interface SessionUser {
  id: string;
  email: string | null;
  role: string;
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getSessionUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function setSession(accessToken: string, refreshToken: string, user: SessionUser) {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// JWT_ACCESS_TTL defaults to 15m server-side (backend/src/auth/auth.service.ts)
// — every page in this app, not just the ones from this session, used to
// just show the backend's raw "Unauthorized" once that clock ran out mid-
// session, since nothing ever called POST /auth/refresh. Coalesced so N
// concurrent 401s (e.g. a page firing Promise.all([...several apiFetch]))
// trigger exactly one refresh call, not N races against the same stored
// refresh token (the backend rotates it — a second racer would send an
// already-revoked one and fail).
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  const user = getSessionUser();
  if (!refreshToken || !user) return false;
  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const { accessToken, refreshToken: rotatedRefreshToken } = await res.json();
    setSession(accessToken, rotatedRefreshToken, user);
    return true;
  } catch {
    return false;
  }
}

/**
 * Thin fetch wrapper for the customer portal. Auth is client-side only for
 * this MVP slice (tokens in localStorage) — fine for the P0 customer
 * experience; a server-rendered/staff-facing surface would need a real
 * session strategy before it carries anything sensitive.
 *
 * `_isRetry` is internal (set only by this function's own retry call) —
 * every real caller keeps the original two-argument signature.
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}, _isRetry = false): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401 && !_isRetry && getRefreshToken()) {
    refreshPromise ??= tryRefresh().finally(() => {
      refreshPromise = null;
    });
    if (await refreshPromise) {
      return apiFetch<T>(path, options, true);
    }
    clearSession();
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new ApiError('Session expired — please sign in again.', 401);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string });
    throw new ApiError(body.message ?? `Request failed with status ${res.status}`, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}
