'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';

interface PartnerRow {
  id: string;
  name: string;
  code: string;
  type: string;
  status: string;
  _count: { referredCustomers: number; contacts: number };
}

// Section 12 P2 "partner portal" — admin side: create partner orgs, see
// who's referred how many customers. A partner-role login account is
// provisioned the same non-self-service way as every other staff/field
// role (see README) and linked via PartnerContact.
export default function OpsPartnersPage() {
  const { ready } = useOpsGuard();
  const [partners, setPartners] = useState<PartnerRow[] | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState('ASSOCIATION');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<PartnerRow[]>('/partners').then(setPartners).catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (ready) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function createPartner(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await apiFetch('/partners', { method: 'POST', body: JSON.stringify({ name, type }) });
      setName('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create partner');
    } finally {
      setCreating(false);
    }
  }

  if (!ready) return null;

  return (
    <div>
      <div className="hero">
        <h1>Partners</h1>
        <p>Referral organisations — associations, businesses, agents. Attribution and visibility only.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>New partner</h2>
        <form onSubmit={createPartner} className="actions-row" style={{ flexWrap: 'wrap' }}>
          <input placeholder="Partner name" value={name} onChange={(e) => setName(e.target.value)} required />
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="ASSOCIATION">Association</option>
            <option value="BUSINESS">Business</option>
            <option value="AGENT">Agent</option>
          </select>
          <button className="btn" type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create partner'}
          </button>
        </form>
      </div>

      <div className="card">
        {partners === null && <p className="muted">Loading…</p>}
        {partners && partners.length === 0 && <p className="muted">No partners yet.</p>}
        {partners && partners.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--asoju-border)' }}>
                <th style={{ padding: '0.4rem' }}>Name</th>
                <th style={{ padding: '0.4rem' }}>Type</th>
                <th style={{ padding: '0.4rem' }}>Code</th>
                <th style={{ padding: '0.4rem' }}>Referred</th>
                <th style={{ padding: '0.4rem' }}>Contacts</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--asoju-border)' }}>
                  <td style={{ padding: '0.4rem' }}>
                    <Link href={`/ops/partners/${p.id}`}><strong>{p.name}</strong></Link>
                  </td>
                  <td style={{ padding: '0.4rem' }}>{p.type}</td>
                  <td style={{ padding: '0.4rem' }}><code>{p.code}</code></td>
                  <td style={{ padding: '0.4rem' }}>{p._count.referredCustomers}</td>
                  <td style={{ padding: '0.4rem' }}>{p._count.contacts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
