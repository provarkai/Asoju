'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';

interface AccountRow {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  _count: { customers: number };
}

// Section 12 P2 "corporate accounts" / "family management dashboard" — the
// existing Account model (defined since Section 3, never wired up until
// now) grouping several customers under one shared, read-only umbrella.
export default function OpsAccountsPage() {
  const { ready } = useOpsGuard();
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState('FAMILY');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<AccountRow[]>('/accounts').then(setAccounts).catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (ready) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function createAccount(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await apiFetch('/accounts', { method: 'POST', body: JSON.stringify({ name, type }) });
      setName('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setCreating(false);
    }
  }

  if (!ready) return null;

  return (
    <div>
      <div className="hero">
        <h1>Accounts</h1>
        <p>Household and company groupings — shared visibility only, case access is unchanged.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>New account</h2>
        <form onSubmit={createAccount} className="actions-row" style={{ flexWrap: 'wrap' }}>
          <input placeholder="Account name" value={name} onChange={(e) => setName(e.target.value)} required />
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="FAMILY">Family</option>
            <option value="CORPORATE">Corporate</option>
          </select>
          <button className="btn" type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create account'}
          </button>
        </form>
      </div>

      <div className="card">
        {accounts === null && <p className="muted">Loading…</p>}
        {accounts && accounts.length === 0 && <p className="muted">No accounts yet.</p>}
        {accounts && accounts.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--asoju-border)' }}>
                <th style={{ padding: '0.4rem' }}>Name</th>
                <th style={{ padding: '0.4rem' }}>Type</th>
                <th style={{ padding: '0.4rem' }}>Members</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid var(--asoju-border)' }}>
                  <td style={{ padding: '0.4rem' }}>
                    <Link href={`/ops/accounts/${a.id}`}><strong>{a.name}</strong></Link>
                  </td>
                  <td style={{ padding: '0.4rem' }}>{a.type}</td>
                  <td style={{ padding: '0.4rem' }}>{a._count.customers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
