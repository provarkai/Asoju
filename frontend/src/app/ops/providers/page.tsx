'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';
import { ADMIN_ROLES } from '@/lib/roles';

interface ProviderRow {
  id: string;
  fullName: string;
  serviceCategory: string;
  status: string;
  performanceScore: number | null;
  user: { email: string | null };
}

const NEXT_STATUS: Record<string, string[]> = {
  PENDING: ['UNDER_REVIEW', 'REMOVED'],
  UNDER_REVIEW: ['VERIFIED', 'REMOVED'],
  VERIFIED: ['ACTIVE', 'RESTRICTED', 'SUSPENDED'],
  ACTIVE: ['RESTRICTED', 'SUSPENDED'],
  RESTRICTED: ['ACTIVE', 'SUSPENDED', 'REMOVED'],
  SUSPENDED: ['ACTIVE', 'RESTRICTED', 'REMOVED'],
  REMOVED: [],
};

export default function OpsProvidersPage() {
  const { user, ready } = useOpsGuard();
  const [providers, setProviders] = useState<ProviderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [serviceCategory, setServiceCategory] = useState('surveyor');

  function load() {
    apiFetch<ProviderRow[]>('/providers').then(setProviders).catch((err) => setError(err.message));
  }

  useEffect(() => {
    if (ready) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/providers', {
        method: 'POST',
        body: JSON.stringify({ fullName, email, password, serviceCategory }),
      });
      setFullName('');
      setEmail('');
      setPassword('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to onboard provider');
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStatus(providerId: string, status: string) {
    try {
      await apiFetch(`/providers/${providerId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    }
  }

  if (!ready) return null;
  const isAdmin = user && ADMIN_ROLES.includes(user.role);

  return (
    <div>
      <div className="hero">
        <h1>Professional providers</h1>
        <p>Surveyors, lawyers, engineers, valuers — coordinated for specialist work, verified before they touch a case.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      {isAdmin && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Onboard a provider</h2>
          <form onSubmit={onSubmit}>
            <label>
              Full name
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </label>
            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Temporary password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            <label>
              Service category
              <select value={serviceCategory} onChange={(e) => setServiceCategory(e.target.value)}>
                <option value="surveyor">Surveyor</option>
                <option value="lawyer">Lawyer</option>
                <option value="engineer">Engineer</option>
                <option value="valuer">Valuer</option>
              </select>
            </label>
            <button className="btn" type="submit" disabled={submitting}>
              {submitting ? 'Onboarding…' : 'Onboard provider'}
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Directory</h2>
        <p className="muted">New providers start Pending and must be walked through the verification lifecycle before they can be assigned.</p>
        {providers === null && <p className="muted">Loading…</p>}
        {providers && providers.length === 0 && <p className="muted">No providers onboarded yet.</p>}
        {providers && providers.length > 0 && (
          <ul>
            {providers.map((p) => (
              <li key={p.id} style={{ marginBottom: '0.4rem' }}>
                <strong>{p.fullName}</strong> ({p.serviceCategory}) — {p.user.email}
                {p.performanceScore !== null && ` · ${p.performanceScore.toFixed(1)}★`}{' '}
                <span className="badge">{p.status.toLowerCase()}</span>
                {isAdmin &&
                  (NEXT_STATUS[p.status] ?? []).map((next) => (
                    <button
                      key={next}
                      className="btn btn--ghost"
                      style={{ marginLeft: '0.4rem', padding: '0.2rem 0.6rem' }}
                      onClick={() => updateStatus(p.id, next)}
                    >
                      → {next.toLowerCase()}
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
