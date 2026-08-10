'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { humanServiceType } from '@/lib/case-status';

interface Testimonial {
  stars: number;
  comment: string;
  serviceType: string;
  createdAt: string;
}

interface PublicStats {
  casesCompleted: number;
  averageRating: number | null;
  consentedRatingCount: number;
  testimonials: Testimonial[];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ flex: '1 1 12rem' }}>
      <div className="muted" style={{ fontSize: '0.8rem' }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Stars({ count }: { count: number }) {
  return <span aria-label={`${count} out of 5 stars`}>{'★'.repeat(count)}{'☆'.repeat(5 - count)}</span>;
}

// Public trust/social-proof page (strategic-suggestions pass) — no login,
// no session guard: this is the one screen in the app meant for someone
// who isn't a customer yet. Every number and quote here comes from
// GET /trust, which only ever draws on ratings a customer opted in to
// making public (Rating.publicConsent) — see TrustService's own comment
// for the one deliberate exception (casesCompleted).
export default function TrustPage() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PublicStats>('/trust')
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
  }, []);

  return (
    <div>
      <div className="hero">
        <h1>What diaspora families are saying</h1>
        <p>
          Every number and quote below comes straight from customers who chose to make their rating
          public — nothing curated, nothing written for us.
        </p>
      </div>

      {error && <p className="error-text">{error}</p>}
      {!stats && !error && <p className="muted">Loading…</p>}

      {stats && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
            <Stat label="Cases completed" value={stats.casesCompleted.toLocaleString()} />
            <Stat
              label="Average rating"
              value={stats.averageRating !== null ? `${stats.averageRating.toFixed(1)} / 5` : '—'}
            />
            <Stat label="Customers who shared a rating publicly" value={stats.consentedRatingCount.toLocaleString()} />
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Testimonials</h2>
            {stats.testimonials.length === 0 ? (
              <p className="muted">
                No public testimonials yet — customers can choose to share theirs after a completed case.
              </p>
            ) : (
              <div className="case-list">
                {stats.testimonials.map((t, i) => (
                  <div key={i} className="case-row" style={{ alignItems: 'flex-start' }}>
                    <div className="case-row__meta">
                      <Stars count={t.stars} />
                      <span>&ldquo;{t.comment}&rdquo;</span>
                      <span className="muted">
                        {humanServiceType(t.serviceType)} · {new Date(t.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
