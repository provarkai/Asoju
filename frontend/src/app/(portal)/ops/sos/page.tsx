'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';

interface SosAlert {
  id: string;
  agentId: string;
  agent: { fullName: string; city: string | null; state: string | null };
  caseId: string | null;
  case: { caseNumber: string } | null;
  alertType: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  address: string | null;
  status: string;
  caseHeld: boolean;
  escalationLevel: number;
  escalatedChannels: string[];
  resolutionNotes: string | null;
  createdAt: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  LOW: 'var(--asoju-muted)',
  MEDIUM: 'var(--asoju-gold)',
  HIGH: '#c2410c',
  CRITICAL: 'var(--asoju-danger)',
};

const ESCALATION_CHANNELS = ['admin', 'whatsapp', 'emergency_contact', 'police'];

function mapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

// #55 — a live SOS test surfaced the actual gap: the notification it
// generated named nothing and linked nowhere, because there was no
// admin-facing SOS review surface anywhere in the app. This is that
// surface — every alert shows the agent, their location, and the linked
// case (if any) inline, and the notification's actionUrl deep-links here
// via ?alert=<id>.
export default function OpsSosPage() {
  return (
    <Suspense fallback={null}>
      <OpsSosPageInner />
    </Suspense>
  );
}

function OpsSosPageInner() {
  const { ready } = useOpsGuard();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('alert');
  const highlightRef = useRef<HTMLDivElement>(null);

  const [active, setActive] = useState<SosAlert[] | null>(null);
  const [history, setHistory] = useState<SosAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});

  const load = () => {
    setError(null);
    Promise.all([apiFetch<SosAlert[]>('/agents/sos/active'), apiFetch<SosAlert[]>('/agents/sos/history')])
      .then(([a, h]) => {
        setActive(a);
        setHistory(h);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load SOS alerts'));
  };

  useEffect(load, []);

  useEffect(() => {
    if (highlightId && active) {
      highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightId, active]);

  async function act(alertId: string, action: 'acknowledge' | 'resolve' | 'false-alarm' | 'escalate', extra?: unknown) {
    setBusy(alertId + action);
    setError(null);
    try {
      await apiFetch(`/agents/sos/${alertId}/${action}`, { method: 'POST', body: JSON.stringify(extra ?? {}) });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  if (!ready) return null;

  function AlertCard({ alert }: { alert: SosAlert }) {
    const isHighlighted = alert.id === highlightId;
    const isTerminal = alert.status === 'RESOLVED' || alert.status === 'FALSE_ALARM';

    return (
      <div
        ref={isHighlighted ? highlightRef : undefined}
        className="card"
        style={{
          marginBottom: '1rem',
          borderLeft: `4px solid ${SEVERITY_COLOR[alert.severity] ?? 'var(--asoju-border)'}`,
          ...(isHighlighted ? { boxShadow: '0 0 0 2px var(--asoju-gold)' } : {}),
        }}
      >
        <div className="actions-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <span className="badge" style={{ background: SEVERITY_COLOR[alert.severity], color: '#fff', marginRight: '0.5rem' }}>
              {alert.severity}
            </span>
            <strong>{alert.alertType}</strong>
            <span className="muted" style={{ marginLeft: '0.5rem' }}>· {alert.status}</span>
          </div>
          <span className="muted" style={{ fontSize: '0.8rem' }}>{new Date(alert.createdAt).toLocaleString()}</span>
        </div>

        <div style={{ marginTop: '0.6rem' }}>
          <strong>{alert.agent.fullName}</strong>
          {(alert.agent.city || alert.agent.state) && (
            <span className="muted"> — {[alert.agent.city, alert.agent.state].filter(Boolean).join(', ')}</span>
          )}
        </div>

        {alert.message && <p style={{ marginTop: '0.4rem' }}>{alert.message}</p>}

        <div className="actions-row" style={{ marginTop: '0.5rem', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.85rem' }}>
          <a href={mapsLink(alert.latitude, alert.longitude)} target="_blank" rel="noreferrer">
            📍 {alert.address ?? `${alert.latitude.toFixed(4)}, ${alert.longitude.toFixed(4)}`}
          </a>
          {alert.case && (
            <Link href={`/ops/cases/${alert.caseId}`}>
              📋 Case {alert.case.caseNumber}
              {alert.caseHeld && ' (put on hold)'}
            </Link>
          )}
        </div>

        {alert.escalationLevel > 0 && (
          <p className="muted" style={{ marginTop: '0.4rem', fontSize: '0.8rem' }}>
            Escalated via: {alert.escalatedChannels.join(' → ')}
          </p>
        )}

        {alert.resolutionNotes && (
          <p className="muted" style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}>
            <strong>Resolution:</strong> {alert.resolutionNotes}
          </p>
        )}

        {!isTerminal && (
          <div className="actions-row" style={{ marginTop: '0.75rem', flexWrap: 'wrap' }}>
            {(alert.status === 'ACTIVE' || alert.status === 'ESCALATED') && (
              <button className="btn" disabled={busy !== null} onClick={() => act(alert.id, 'acknowledge')}>
                {busy === alert.id + 'acknowledge' ? 'Acknowledging…' : 'Acknowledge'}
              </button>
            )}
            {alert.escalationLevel < ESCALATION_CHANNELS.length && (
              <button
                className="btn btn--secondary"
                disabled={busy !== null}
                onClick={() => act(alert.id, 'escalate', { channel: ESCALATION_CHANNELS[alert.escalationLevel] })}
              >
                {busy === alert.id + 'escalate' ? 'Escalating…' : `Escalate → ${ESCALATION_CHANNELS[alert.escalationLevel]}`}
              </button>
            )}
            <input
              placeholder="Resolution notes…"
              value={notesDraft[alert.id] ?? ''}
              onChange={(e) => setNotesDraft((d) => ({ ...d, [alert.id]: e.target.value }))}
              style={{ minWidth: '14rem' }}
            />
            <button
              className="btn"
              disabled={busy !== null || !(notesDraft[alert.id]?.trim().length >= 3)}
              onClick={() => act(alert.id, 'resolve', { resolutionNotes: notesDraft[alert.id] })}
            >
              {busy === alert.id + 'resolve' ? 'Resolving…' : 'Resolve'}
            </button>
            <button
              className="btn btn--ghost"
              disabled={busy !== null || !(notesDraft[alert.id]?.trim().length >= 3)}
              onClick={() => act(alert.id, 'false-alarm', { resolutionNotes: notesDraft[alert.id] })}
            >
              {busy === alert.id + 'false-alarm' ? 'Marking…' : 'False alarm'}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="hero">
        <h1>Emergency SOS</h1>
        <p>Every active field-agent alert, who triggered it, where they are, and what case (if any) it's tied to.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      <h2>Active ({active?.length ?? '…'})</h2>
      {active === null && !error && <p className="muted">Loading…</p>}
      {active && active.length === 0 && <p className="muted">No active alerts. All clear.</p>}
      {active?.map((a) => <AlertCard key={a.id} alert={a} />)}

      <h2 style={{ marginTop: '2rem' }}>History</h2>
      {history === null && !error && <p className="muted">Loading…</p>}
      {history && history.length === 0 && <p className="muted">Nothing yet.</p>}
      {history?.map((a) => <AlertCard key={a.id} alert={a} />)}
    </div>
  );
}
