'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useFieldGuard } from '@/lib/useFieldGuard';

interface Credential {
  id: string;
  type: string;
  issuer: string | null;
  reference: string | null;
  verifiedAt: string | null;
}

interface OwnProfile {
  fullName: string;
  serviceCategory: string;
  status: string;
  performanceScore: number | null;
  credentials: Credential[];
}

// Section 12 P1 "advanced provider portal" — self-service credentials.
export default function FieldCredentialsPage() {
  const { user, ready } = useFieldGuard();
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [type, setType] = useState('license');
  const [issuer, setIssuer] = useState('');
  const [reference, setReference] = useState('');

  function load() {
    apiFetch<OwnProfile>('/providers/me').then(setProfile).catch((err) => setError(err.message));
  }

  useEffect(() => {
    if (ready && user?.role === 'PROVIDER') load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/providers/me/credentials', {
        method: 'POST',
        body: JSON.stringify({ type, issuer: issuer || undefined, reference: reference || undefined }),
      });
      setIssuer('');
      setReference('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add credential');
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) return null;
  if (user?.role !== 'PROVIDER') {
    return <p className="muted">Credentials are for professional providers — field agents don&apos;t need this page.</p>;
  }

  return (
    <div>
      <div className="hero">
        <h1>Your credentials</h1>
        <p>Licenses, certifications, and references — verified by ASOJU before they count toward an assignment.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      {profile && (
        <div className="card">
          <p>
            <strong>{profile.fullName}</strong> · {profile.serviceCategory} · <span className="badge">{profile.status.toLowerCase()}</span>
            {profile.performanceScore !== null && ` · ${profile.performanceScore.toFixed(1)}★`}
          </p>
          {profile.credentials.length === 0 ? (
            <p className="muted">No credentials on file yet.</p>
          ) : (
            <ul>
              {profile.credentials.map((c) => (
                <li key={c.id}>
                  {c.type}{c.issuer ? ` — ${c.issuer}` : ''}{' '}
                  <span className={c.verifiedAt ? 'badge' : 'muted'}>
                    {c.verifiedAt ? 'verified' : 'pending verification'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Add a credential</h2>
        <form onSubmit={onSubmit}>
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="license">License</option>
              <option value="certification">Certification</option>
              <option value="reference">Reference</option>
            </select>
          </label>
          <label>
            Issuer
            <input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="e.g. NIESV" />
          </label>
          <label>
            Reference number
            <input value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
          <button className="btn" type="submit" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add credential'}
          </button>
        </form>
      </div>
    </div>
  );
}
