'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';
import { ADMIN_ROLES } from '@/lib/roles';

interface FeedbackRow {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  customer: { fullName: string };
  interaction: { promptSummary: string | null } | null;
}

// "Concierge Lab" — ported from asoju-app-main's TeamView (the one
// genuinely new piece in that admin-only board; the case-list/case-
// detail parts were a redundant duplicate of the rest of this /ops
// console and weren't ported — see the (customer) layout's comment).
//
// Note: nothing currently POSTs to /me/concierge-feedback — the landing
// page's AI Concierge demo (AiConciergeDemo) is anonymous and its
// thumbs up/down are local-only by design (ConciergeFeedback is tied to
// a real customerId; there's no anonymous-feedback surface). This page
// is real, working infrastructure that will show "No ratings yet" until
// a rating UI exists somewhere a signed-in customer talks to the AI
// (e.g. the existing AssistantChat component) — that wiring wasn't part
// of this conversion.
export default function ConciergeLabPage() {
  const { user, ready } = useOpsGuard();
  const router = useRouter();
  const [feedback, setFeedback] = useState<FeedbackRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !user || !ADMIN_ROLES.includes(user.role)) return;
    apiFetch<FeedbackRow[]>('/admin/concierge-feedback')
      .then(setFeedback)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load feedback'));
  }, [ready, user]);

  if (!ready) return null;

  if (!ADMIN_ROLES.includes(user!.role)) {
    return (
      <div className="card">
        <h1>Admin access required</h1>
        <p className="muted">Concierge Lab is restricted to ASOJU admin accounts.</p>
        <button className="btn" onClick={() => router.push('/ops')}>
          Back to queue
        </button>
      </div>
    );
  }

  const total = feedback?.length ?? 0;
  const positive = feedback?.filter((f) => f.rating >= 4).length ?? 0;
  const passRate = total > 0 ? Math.round((positive / total) * 100) : 0;

  return (
    <div>
      <div className="hero">
        <h1>Concierge Lab</h1>
        <p>Customer ratings on the AI Concierge — the raw material for tuning it.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      {feedback && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
          <div className="card" style={{ flex: '1 1 12rem' }}>
            <div className="muted" style={{ fontSize: '0.8rem' }}>Rated</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{total}</div>
          </div>
          <div className="card" style={{ flex: '1 1 12rem' }}>
            <div className="muted" style={{ fontSize: '0.8rem' }}>Pass rate (4-5★)</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{passRate}%</div>
          </div>
        </div>
      )}

      <div className="card">
        {feedback === null ? (
          <p className="muted">Loading…</p>
        ) : feedback.length === 0 ? (
          <p className="muted">No ratings yet — they&apos;ll appear here as customers rate AI Concierge replies.</p>
        ) : (
          <div className="case-list">
            {feedback.map((f) => (
              <div key={f.id} className="case-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: '0.4rem' }}>
                <div className="case-row__meta" style={{ width: '100%' }}>
                  <strong>{f.customer.fullName}</strong>
                  <span className="muted">{new Date(f.createdAt).toLocaleString()}</span>
                </div>
                {f.interaction?.promptSummary && <p className="muted">Re: {f.interaction.promptSummary}</p>}
                {f.comment && <p>{f.comment}</p>}
                <span className="badge">{'★'.repeat(f.rating)}{'☆'.repeat(5 - f.rating)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
