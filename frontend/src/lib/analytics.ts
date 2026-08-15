import { apiFetch } from './api';

const SESSION_ID_KEY = 'asoju-analytics-session-id';

/**
 * FRONTEND_HANDOFF_V1_GAP_MAP.md §5/§8 — first-party AI Concierge usage
 * analytics (backend: AiPublicController.recordAnalyticsEvent, see its
 * own comment for the "no third-party vendor, coarse-only, validated at
 * the boundary" rationale). This client-side half exists only to keep
 * that contract: never pass anything here beyond the small set of
 * primitive fields each call site already uses — the backend enforces
 * the bound, but there is no reason to rely on it as the only guard.
 *
 * A random per-tab id, not a userId — most Concierge usage is anonymous
 * (homepage/service-page visitors before sign-in), and this exists to
 * correlate events within one visit, not to identify who the visitor is.
 * sessionStorage (not localStorage), same convention as the concierge
 * demo's own draft-persistence handoff: scoped to this tab's visit only.
 */
function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_ID_KEY, id);
    return id;
  } catch {
    // Storage unavailable (private browsing, quota, disabled) — a
    // one-off id still lets this single event carry a sessionId, it
    // just won't correlate with any other event from this visit.
    return crypto.randomUUID();
  }
}

export type ConciergeAnalyticsEventName =
  | 'CONCIERGE_OPENED'
  | 'QUICK_PROMPT_CLICKED'
  | 'MESSAGE_SENT'
  | 'MESSAGE_FAILED'
  | 'RETRY_CLICKED';

/**
 * Fire-and-forget by design — analytics must never affect the Concierge
 * experience itself. Swallows every failure (network error, throttled,
 * ad-blocker) rather than surfacing it, and the caller never awaits
 * anything from this beyond "the request was sent".
 */
export function trackConciergeEvent(
  name: ConciergeAnalyticsEventName,
  metadata?: Record<string, string | number | boolean>,
): void {
  if (typeof window === 'undefined') return;
  apiFetch('/ai/concierge/analytics-event', {
    method: 'POST',
    body: JSON.stringify({ name, sessionId: getSessionId(), metadata }),
  }).catch(() => {
    // Best-effort — see the function comment above.
  });
}
