'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useFieldGuard } from '@/lib/useFieldGuard';
import { humanCaseStatus, humanServiceType } from '@/lib/case-status';
import { enqueue, flushQueue, getQueue, isNetworkFailure, QueuedAction } from '@/lib/offlineQueue';

interface AssignmentDetail {
  id: string;
  status: string;
  checkInAt: string | null;
}

interface TaskItem {
  id: string;
  label: string;
  isComplete: boolean;
}

interface EvidenceItem {
  id: string;
  type: string;
  description: string | null;
}

interface JobDetail {
  id: string;
  caseNumber: string;
  serviceType: string;
  status: string;
  location: string;
  description: string;
  priority: string;
  assignments: AssignmentDetail[];
  tasks: TaskItem[];
  evidence: EvidenceItem[];
}

const EVIDENCE_TYPES = ['PHOTO', 'VIDEO', 'DOCUMENT', 'VOICE', 'LOCATION', 'NOTE'];

export default function FieldJobDetailPage() {
  const { ready } = useFieldGuard();
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [evidenceType, setEvidenceType] = useState('PHOTO');
  const [evidenceDescription, setEvidenceDescription] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [exceptionLabel, setExceptionLabel] = useState('');
  const [exceptionDetail, setExceptionDetail] = useState('');

  // Section 5.4 "offline support" — checklist ticks and evidence captured
  // without a connection queue locally and sync automatically once one
  // comes back (see lib/offlineQueue).
  const [queued, setQueued] = useState<QueuedAction[]>([]);
  const [isOnline, setIsOnline] = useState(true);

  function load() {
    setError(null);
    apiFetch<JobDetail>(`/cases/${params.id}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load job'));
  }

  function refreshQueue() {
    if (params.id) setQueued(getQueue(params.id));
  }

  async function trySync() {
    if (!params.id) return;
    const flushed = await flushQueue(params.id);
    refreshQueue();
    if (flushed > 0) load();
  }

  useEffect(() => {
    if (!ready) return;
    load();
    refreshQueue();
    setIsOnline(navigator.onLine);
    trySync();

    const onOnline = () => {
      setIsOnline(true);
      trySync();
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, params.id]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  function checkIn(assignmentId: string) {
    run('checkin', async () => {
      const location = await new Promise<Record<string, unknown> | undefined>((resolve) => {
        if (!navigator.geolocation) return resolve(undefined);
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(undefined),
          { timeout: 5000 },
        );
      });
      return apiFetch(`/assignments/${assignmentId}/check-in`, {
        method: 'POST',
        body: JSON.stringify({ location }),
      });
    });
  }

  async function toggleTask(taskId: string) {
    if (!detail) return;
    const path = `/cases/${detail.id}/tasks/${taskId}/complete`;
    try {
      await apiFetch(path, { method: 'POST' });
      load();
    } catch (err) {
      if (!isNetworkFailure(err)) {
        setError(err instanceof Error ? err.message : 'Action failed');
        return;
      }
      // Offline — queue it and reflect the tick locally so the agent can
      // keep working through the rest of the checklist.
      enqueue({ kind: 'task', caseId: detail.id, path, body: {}, taskId });
      refreshQueue();
      setDetail({ ...detail, tasks: detail.tasks.map((t) => (t.id === taskId ? { ...t, isComplete: true } : t)) });
    }
  }

  async function submitEvidence() {
    if (!detail) return;
    const path = `/cases/${detail.id}/evidence`;
    // Same key on the first attempt and any offline-queue replay of it, so
    // a dropped response never creates a duplicate Evidence row server-side.
    const body = {
      type: evidenceType,
      description: evidenceDescription || undefined,
      storageKey: evidenceRef,
      clientRequestId: crypto.randomUUID(),
    };
    setBusy('evidence');
    setError(null);
    try {
      await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
      setEvidenceDescription('');
      setEvidenceRef('');
      load();
    } catch (err) {
      if (!isNetworkFailure(err)) {
        setError(err instanceof Error ? err.message : 'Action failed');
      } else {
        enqueue({ kind: 'evidence', caseId: detail.id, path, body });
        refreshQueue();
        setDetail({
          ...detail,
          evidence: [...detail.evidence, { id: `queued-${Date.now()}`, type: evidenceType, description: evidenceDescription || null }],
        });
        setEvidenceDescription('');
        setEvidenceRef('');
      }
    } finally {
      setBusy(null);
    }
  }

  if (!ready) return null;
  if (error && !detail) return <p className="error-text">{error}</p>;
  if (!detail) return <p className="muted">Loading…</p>;

  const assignment = detail.assignments[0];
  const canWork = detail.status === 'IN_PROGRESS';

  return (
    <div>
      <div className="hero">
        <h1>{detail.caseNumber}</h1>
        <p>
          {humanServiceType(detail.serviceType)} · {detail.location}
        </p>
        <span className="badge">{humanCaseStatus(detail.status)}</span>
      </div>

      {error && <p className="error-text">{error}</p>}
      {(!isOnline || queued.length > 0) && (
        <p className="muted" style={{ background: 'var(--asoju-green-light)', padding: '0.6rem 0.9rem', borderRadius: '0.5rem' }}>
          {!isOnline ? "You're offline — " : ''}
          {queued.length > 0
            ? `${queued.length} change${queued.length === 1 ? '' : 's'} saved on this device, will sync automatically once you're back online.`
            : 'Back online.'}
        </p>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Instructions</h2>
        <p>{detail.description}</p>
        <p className="muted">Priority: {detail.priority}</p>
      </div>

      {assignment && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Your assignment</h2>
          <p>
            Status: <strong>{assignment.status.toLowerCase()}</strong>
            {assignment.checkInAt && ` — checked in ${new Date(assignment.checkInAt).toLocaleString()}`}
          </p>
          <div className="actions-row">
            {assignment.status === 'OFFERED' && (
              <>
                <button
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => run('accept', () => apiFetch(`/assignments/${assignment.id}/accept`, { method: 'POST' }))}
                >
                  {busy === 'accept' ? 'Accepting…' : 'Accept'}
                </button>
                <button
                  className="btn btn--secondary"
                  disabled={busy !== null}
                  onClick={() => run('decline', () => apiFetch(`/assignments/${assignment.id}/decline`, { method: 'POST' }))}
                >
                  {busy === 'decline' ? 'Declining…' : 'Decline'}
                </button>
              </>
            )}
            {assignment.status === 'ACCEPTED' && !assignment.checkInAt && (
              <button className="btn" disabled={busy !== null} onClick={() => checkIn(assignment.id)}>
                {busy === 'checkin' ? 'Checking in…' : 'Check in'}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Checklist</h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {detail.tasks.map((t) => (
            <li key={t.id} style={{ marginBottom: '0.5rem' }}>
              <label style={{ flexDirection: 'row', alignItems: 'center', fontWeight: 400 }}>
                <input
                  type="checkbox"
                  checked={t.isComplete}
                  disabled={t.isComplete || !canWork}
                  onChange={() => toggleTask(t.id)}
                  style={{ marginRight: '0.5rem' }}
                />
                {t.label}
                {queued.some((q) => q.taskId === t.id) && <span className="muted"> (queued)</span>}
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Evidence</h2>
        {detail.evidence.length > 0 && (
          <ul>
            {detail.evidence.map((e) => (
              <li key={e.id}>
                {e.type} — {e.description ?? 'No description'}
                {e.id.startsWith('queued-') && <span className="muted"> (queued, will sync)</span>}
              </li>
            ))}
          </ul>
        )}
        {canWork && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '28rem' }}>
            <select value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)}>
              {EVIDENCE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input
              placeholder="Description"
              value={evidenceDescription}
              onChange={(e) => setEvidenceDescription(e.target.value)}
            />
            <input
              placeholder="File reference (upload integration pending)"
              value={evidenceRef}
              onChange={(e) => setEvidenceRef(e.target.value)}
            />
            <button
              className="btn"
              style={{ alignSelf: 'flex-start' }}
              disabled={!evidenceRef || busy !== null}
              onClick={submitEvidence}
            >
              {busy === 'evidence' ? 'Submitting…' : 'Add evidence'}
            </button>
          </div>
        )}
      </div>

      {canWork && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Submit &amp; escalate</h2>
          <p className="muted">Submitting sends this to quality control — make sure your evidence is complete first.</p>
          <button
            className="btn"
            disabled={detail.evidence.length === 0 || busy !== null}
            onClick={() => run('submit', () => apiFetch(`/cases/${detail.id}/evidence/complete`, { method: 'POST' }))}
          >
            {busy === 'submit' ? 'Submitting…' : 'Submit fieldwork'}
          </button>

          <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '28rem' }}>
            <strong>Escalate an exception</strong>
            <input
              placeholder="What's wrong? (e.g. Access blocked)"
              value={exceptionLabel}
              onChange={(e) => setExceptionLabel(e.target.value)}
            />
            <input
              placeholder="Details (optional)"
              value={exceptionDetail}
              onChange={(e) => setExceptionDetail(e.target.value)}
            />
            <button
              className="btn btn--secondary"
              style={{ alignSelf: 'flex-start' }}
              disabled={!exceptionLabel || busy !== null}
              onClick={() =>
                run('exception', async () => {
                  await apiFetch(`/cases/${detail.id}/exceptions`, {
                    method: 'POST',
                    body: JSON.stringify({ label: exceptionLabel, detail: exceptionDetail || undefined }),
                  });
                  setExceptionLabel('');
                  setExceptionDetail('');
                })
              }
            >
              {busy === 'exception' ? 'Flagging…' : 'Flag exception'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
