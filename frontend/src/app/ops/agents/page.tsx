'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';
import { ADMIN_ROLES } from '@/lib/roles';

interface AgentRow {
  id: string;
  fullName: string;
  city: string | null;
  state: string | null;
  isActive: boolean;
  user: { email: string | null; phone: string | null };
}

export default function OpsAgentsPage() {
  const { user, ready } = useOpsGuard();
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [city, setCity] = useState('');

  function load() {
    apiFetch<AgentRow[]>('/agents').then(setAgents).catch((err) => setError(err.message));
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
      await apiFetch('/agents', {
        method: 'POST',
        body: JSON.stringify({ fullName, email, password, city: city || undefined }),
      });
      setFullName('');
      setEmail('');
      setPassword('');
      setCity('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to onboard agent');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(agentId: string, isActive: boolean) {
    await apiFetch(`/agents/${agentId}/active`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
    load();
  }

  if (!ready) return null;
  const isAdmin = user && ADMIN_ROLES.includes(user.role);

  return (
    <div>
      <div className="hero">
        <h1>Field agents</h1>
        <p>The physical extension of ASOJU — the people who actually show up.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      {isAdmin && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Onboard an agent</h2>
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
              City
              <input value={city} onChange={(e) => setCity(e.target.value)} />
            </label>
            <button className="btn" type="submit" disabled={submitting}>
              {submitting ? 'Onboarding…' : 'Onboard agent'}
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Directory</h2>
        {agents === null && <p className="muted">Loading…</p>}
        {agents && agents.length === 0 && <p className="muted">No agents onboarded yet.</p>}
        {agents && agents.length > 0 && (
          <ul>
            {agents.map((a) => (
              <li key={a.id} style={{ marginBottom: '0.4rem' }}>
                <strong>{a.fullName}</strong> — {a.user.email} · {a.city ?? 'no city set'}{' '}
                <span className={a.isActive ? 'badge' : 'error-text'}>{a.isActive ? 'active' : 'inactive'}</span>
                {isAdmin && (
                  <button
                    className="btn btn--ghost"
                    style={{ marginLeft: '0.6rem', padding: '0.2rem 0.6rem' }}
                    onClick={() => toggleActive(a.id, !a.isActive)}
                  >
                    {a.isActive ? 'Deactivate' : 'Reactivate'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
