'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';
import { humanCaseStatus, humanServiceType } from '@/lib/case-status';

interface CaseSummary {
  id: string;
  caseNumber: string;
  serviceType: string;
  status: string;
  createdAt: string;
  paidAmount: number;
}
interface Member { id: string; fullName: string; email: string | null; cases: CaseSummary[] }
interface AccountDetail {
  account: { id: string; name: string; type: string };
  members: Member[];
}
interface CustomerOption { id: string; fullName: string; user: { email: string | null } }

export default function OpsAccountDetailPage() {
  const { ready } = useOpsGuard();
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [candidates, setCandidates] = useState<CustomerOption[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<AccountDetail>(`/accounts/${params.id}`).then(setDetail).catch((e) => setError(e.message));
    apiFetch<CustomerOption[]>('/concierge/customers').then(setCandidates).catch(() => {});
  }

  useEffect(() => {
    if (ready) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, params.id]);

  async function addMember() {
    if (!selected) return;
    try {
      await apiFetch(`/accounts/${params.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ customerId: selected }),
      });
      setSelected('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    }
  }

  async function removeMember(customerId: string) {
    try {
      await apiFetch(`/accounts/${params.id}/members/${customerId}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    }
  }

  if (!ready) return null;
  if (error) return <p className="error-text">{error}</p>;
  if (!detail) return <p className="muted">Loading…</p>;

  const memberIds = new Set(detail.members.map((m) => m.id));
  const available = candidates.filter((c) => !memberIds.has(c.id));

  return (
    <div>
      <div className="hero">
        <h1>{detail.account.name}</h1>
        <p className="muted">{detail.account.type === 'CORPORATE' ? 'Corporate account' : 'Family account'}</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Add member</h2>
        <div className="actions-row">
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Select a customer…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>{c.fullName} ({c.user.email})</option>
            ))}
          </select>
          <button className="btn" onClick={addMember} disabled={!selected}>Add to account</button>
        </div>
      </div>

      {detail.members.map((member) => {
        const totalPaid = member.cases.reduce((sum, c) => sum + c.paidAmount, 0);
        return (
          <div key={member.id} className="card">
            <div className="actions-row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>
                <Link href={`/ops/customers/${member.id}`}>{member.fullName}</Link>{' '}
                <span className="muted" style={{ fontWeight: 400 }}>({member.email})</span>
              </h2>
              <div className="actions-row">
                <span className="badge">₦{totalPaid.toLocaleString()} paid</span>
                <button className="btn btn--ghost" onClick={() => removeMember(member.id)}>Remove from account</button>
              </div>
            </div>
            {member.cases.length === 0 && <p className="muted">No cases yet.</p>}
            {member.cases.map((c) => (
              <div key={c.id} className="case-row">
                <Link href={`/ops/cases/${c.id}`}>{c.caseNumber}</Link>
                <span className="muted">{humanServiceType(c.serviceType)}</span>
                <span className="badge">{humanCaseStatus(c.status)}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
