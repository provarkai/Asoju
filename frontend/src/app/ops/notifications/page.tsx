'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';

interface FailedNotification {
  id: string;
  title: string;
  body: string;
  channel: string | null;
  deliveryStatus: string;
  failureReason: string | null;
  createdAt: string;
  user: { email: string | null; phone: string | null; preferredChannel: string | null };
}

// P0 API Specification & Integration Contracts v1.0 §30 "Notification
// APIs" — POST /notifications/{id}/retry. A real WhatsApp/email send is
// now actually attempted for a customer's preferred channel when its
// provider is configured; this is where a genuine delivery failure shows
// up for staff to retry, rather than a customer silently never hearing
// back.
export default function OpsFailedNotificationsPage() {
  const { ready } = useOpsGuard();
  const [notifications, setNotifications] = useState<FailedNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    setError(null);
    apiFetch<FailedNotification[]>('/notifications/admin/failed')
      .then(setNotifications)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
  }

  useEffect(() => {
    if (ready) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function retry(id: string) {
    setBusy(id);
    setError(null);
    try {
      await apiFetch(`/notifications/admin/${id}/retry`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setBusy(null);
    }
  }

  if (!ready) return null;

  return (
    <div>
      <div className="hero">
        <h1>Failed notifications</h1>
        <p className="muted">
          A customer&apos;s preferred channel (WhatsApp/email) had a real send attempted and it failed —
          the in-app notification still exists, but they never got the external message. Retry once
          whatever caused it is fixed.
        </p>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        {notifications === null && <p className="muted">Loading…</p>}
        {notifications && notifications.length === 0 && <p className="muted">No failed deliveries — all caught up.</p>}
        {notifications && notifications.length > 0 && (
          <div className="case-list">
            {notifications.map((n) => (
              <div key={n.id} className="case-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}>
                <div className="actions-row" style={{ justifyContent: 'space-between' }}>
                  <span>
                    <strong>{n.title}</strong> — {n.channel} to {n.user.email ?? n.user.phone ?? 'unknown'}
                  </span>
                  <span className="badge badge--error">{n.deliveryStatus}</span>
                </div>
                <span className="muted">{n.body}</span>
                {n.failureReason && <span className="error-text">{n.failureReason}</span>}
                <div className="actions-row">
                  <span className="muted">{new Date(n.createdAt).toLocaleString()}</span>
                  <button className="btn btn--secondary" disabled={busy !== null} onClick={() => retry(n.id)}>
                    {busy === n.id ? 'Retrying…' : 'Retry'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
