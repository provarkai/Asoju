import { apiFetch, ApiError } from './api';

/**
 * Section 5.4 Field Agent App "offline support" — a poor-connectivity
 * agent shouldn't lose an in-progress checklist tick or evidence capture.
 * Deliberately scoped to those two actions (the ones the README committed
 * to), not every mutation on the job card: check-in wants a live
 * timestamp/GPS fix, and accept/decline/submit are meaningful only against
 * the assignment's current (online) state.
 *
 * Queued items persist to localStorage so a killed tab or reload before
 * reconnecting doesn't lose them either.
 */

export type QueuedActionKind = 'task' | 'evidence';

export interface QueuedAction {
  id: string;
  kind: QueuedActionKind;
  caseId: string;
  path: string;
  body: unknown;
  createdAt: number;
  /** For 'task' actions — lets the UI show the checklist item as queued. */
  taskId?: string;
}

const STORAGE_KEY = 'asoju_offline_queue';

function readAll(): QueuedAction[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueuedAction[]) : [];
  } catch {
    return [];
  }
}

function writeAll(actions: QueuedAction[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
}

export function getQueue(caseId: string): QueuedAction[] {
  return readAll().filter((a) => a.caseId === caseId);
}

export function enqueue(action: Omit<QueuedAction, 'id' | 'createdAt'>): QueuedAction {
  const full: QueuedAction = { ...action, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, createdAt: Date.now() };
  writeAll([...readAll(), full]);
  return full;
}

function removeFromQueue(id: string) {
  writeAll(readAll().filter((a) => a.id !== id));
}

/** True for a genuine network failure (offline, DNS, connection refused) —
 * false for a real server response like 400/403/404, which should surface
 * to the user rather than be silently queued and retried forever. */
export function isNetworkFailure(err: unknown): boolean {
  return !(err instanceof ApiError);
}

/** Replays queued actions for one case, in the order they were captured,
 * stopping at the first failure so ordering is never skipped. Returns how
 * many succeeded. Call on mount and on the browser's 'online' event. */
export async function flushQueue(caseId: string): Promise<number> {
  if (typeof window === 'undefined' || !navigator.onLine) return 0;

  let flushed = 0;
  for (const action of getQueue(caseId)) {
    try {
      await apiFetch(action.path, { method: 'POST', body: JSON.stringify(action.body) });
      removeFromQueue(action.id);
      flushed += 1;
    } catch (err) {
      if (isNetworkFailure(err)) break; // still offline — stop, try again next trigger
      // A real server rejection (e.g. task already complete) — drop it
      // rather than retry forever, but don't silently hide that it happened.
      // eslint-disable-next-line no-console
      console.warn('Dropping queued action that the server rejected', action, err);
      removeFromQueue(action.id);
    }
  }
  return flushed;
}
