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

/**
 * Thin fetch wrapper for the customer portal. Auth is client-side only for
 * this MVP slice (tokens in localStorage) — fine for the P0 customer
 * experience; a server-rendered/staff-facing surface would need a real
 * session strategy before it carries anything sensitive.
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string });
    throw new ApiError(body.message ?? `Request failed with status ${res.status}`, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}
