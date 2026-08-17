'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getSessionUser } from '@/lib/api';
import { useFieldGuard } from '@/lib/useFieldGuard';
import { useFieldAgentId } from '@/lib/useFieldAgentId';

interface TrustScore {
  compositeScore: number;
  completionScore: number;
  gpsComplianceScore: number;
  evidenceScore: number;
  ratingScore: number;
  responseScore: number;
  trustTier: string;
  trustBadge: string | null;
  scoreTrend: 'IMPROVING' | 'DECLINING' | 'STABLE';
  totalAssignments: number;
  completedAssignments: number;
}

const TIER_COLOR: Record<string, string> = {
  NEW: 'var(--asoju-muted)',
  BRONZE: '#b08d57',
  SILVER: '#9a9a9a',
  GOLD: 'var(--asoju-gold)',
  PLATINUM: 'var(--asoju-green)',
};

const TREND_LABEL: Record<string, string> = {
  IMPROVING: '↑ Improving',
  DECLINING: '↓ Declining',
  STABLE: '→ Stable',
};

const SOS_ALERT_TYPES = ['GENERAL', 'MEDICAL', 'SECURITY', 'SAFETY', 'LOST'];
const SOS_SEVERITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ marginBottom: '0.6rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.2rem' }}>
        <span>{label}</span>
        <span className="muted">{Math.round(value)}</span>
      </div>
      <div style={{ height: '6px', background: 'var(--asoju-border)', borderRadius: '999px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, value))}%`, background: 'var(--asoju-green)' }} />
      </div>
    </div>
  );
}

// #54 — trust score (#37) and the SOS protocol (#40) both already worked
// on the backend with FIELD_AGENT self-access, with no frontend surface
// at all. This is that missing surface, plus the one persistent safety
// action every screen in the field portal now links to (see layout.tsx).
export default function FieldProfilePage() {
  const { ready: guardReady } = useFieldGuard();
  const { agentId, ready: agentReady } = useFieldAgentId();
  const user = getSessionUser();

  const [trust, setTrust] = useState<TrustScore | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [alertType, setAlertType] = useState('GENERAL');
  const [severity, setSeverity] = useState('MEDIUM');
  const [message, setMessage] = useState('');
  const [sosStatus, setSosStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [sosError, setSosError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentReady || !agentId) return;
    apiFetch<TrustScore>(`/agents/${agentId}/trust-score`)
      .then(setTrust)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load performance'));
  }, [agentReady, agentId]);

  async function triggerSos() {
    setSosStatus('sending');
    setSosError(null);

    const position = await new Promise<GeolocationPosition | null>((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 10000, enableHighAccuracy: true });
    });
    if (!position) {
      setSosStatus('error');
      setSosError("Couldn't get your location — SOS needs it so help can find you. Try again, or call emergency services directly.");
      return;
    }

    try {
      await apiFetch('/agents/sos', {
        method: 'POST',
        body: JSON.stringify({
          alertType,
          severity,
          message: message || undefined,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      });
      setSosStatus('sent');
    } catch (err) {
      setSosStatus('error');
      setSosError(err instanceof Error ? err.message : 'Failed to send — try again or call emergency services directly.');
    }
  }

  if (!guardReady || !agentReady) return null;

  return (
    <div>
      <div className="hero">
        <h1>Profile &amp; safety</h1>
        <p>Your performance standing, and how to get help fast if something goes wrong.</p>
        {user?.role === 'PROVIDER' && (
          <p>
            <Link href="/field/credentials">Manage your credentials →</Link>
          </p>
        )}
      </div>

      {!agentId ? (
        <div className="card">
          <p className="muted">Performance tracking applies to field agent accounts — not available for provider accounts.</p>
        </div>
      ) : (
        <>
          {error && <p className="error-text">{error}</p>}
          {!trust && !error && <p className="muted">Loading…</p>}

          {trust && (
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div>
                  <span className="badge" style={{ background: 'transparent', border: `1px solid ${TIER_COLOR[trust.trustTier] ?? 'var(--asoju-border)'}`, color: TIER_COLOR[trust.trustTier] ?? 'var(--asoju-ink)' }}>
                    {trust.trustTier}
                    {trust.trustBadge ? ` · ${trust.trustBadge}` : ''}
                  </span>
                  <div style={{ fontSize: '2rem', fontWeight: 700, marginTop: '0.4rem' }}>{Math.round(trust.compositeScore)}</div>
                  <span className="muted">{TREND_LABEL[trust.scoreTrend]}</span>
                </div>
                <div className="muted" style={{ textAlign: 'right' }}>
                  <div>{trust.completedAssignments} of {trust.totalAssignments} jobs completed</div>
                </div>
              </div>

              <ScoreBar label="Job completion" value={trust.completionScore} />
              <ScoreBar label="Check-in geofence compliance" value={trust.gpsComplianceScore} />
              <ScoreBar label="On-time evidence" value={trust.evidenceScore} />
              <ScoreBar label="Customer rating" value={trust.ratingScore} />
              <ScoreBar label="Response time" value={trust.responseScore} />
            </div>
          )}

          <div className="card" id="sos" style={{ border: '1px solid var(--asoju-danger)' }}>
            <h2 style={{ marginTop: 0, color: 'var(--asoju-danger)' }}>Emergency SOS</h2>
            <p className="muted">
              Sends your live location to Ops immediately. A HIGH or CRITICAL alert on an active job puts that case on hold automatically.
            </p>

            {sosStatus === 'sent' ? (
              <p style={{ color: 'var(--asoju-danger)', fontWeight: 600 }}>
                Alert sent — Ops has been notified with your location. Stay safe; someone will reach out.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '28rem' }}>
                <label>
                  Type
                  <select value={alertType} onChange={(e) => setAlertType(e.target.value)}>
                    {SOS_ALERT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Severity
                  <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                    {SOS_SEVERITY_LEVELS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <input placeholder="What's happening? (optional)" value={message} onChange={(e) => setMessage(e.target.value)} />
                {sosError && <p className="error-text">{sosError}</p>}
                <button
                  className="btn"
                  style={{ background: 'var(--asoju-danger)', borderColor: 'var(--asoju-danger)', alignSelf: 'flex-start' }}
                  disabled={sosStatus === 'sending'}
                  onClick={triggerSos}
                >
                  {sosStatus === 'sending' ? 'Sending…' : '🆘 Send SOS now'}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
