'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { useFieldGuard } from '@/lib/useFieldGuard';
import { humanCaseStatus, humanServiceType } from '@/lib/case-status';
import { enqueue, flushQueue, getQueue, isNetworkFailure, QueuedAction } from '@/lib/offlineQueue';
import { MilestoneProgress } from '@/components/MilestoneProgress';

interface AssignmentDetail {
  id: string;
  status: string;
  checkInAt: string | null;
}

interface TaskItem {
  id: string;
  label: string;
  isComplete: boolean;
  milestoneGroup: string | null;
}

interface EvidenceItem {
  id: string;
  type: string;
  description: string | null;
  viewUrl?: string;
}

interface ScopeVersion {
  id: string;
  version: number;
  objective: string;
  tasks: string[];
  exclusions: string[];
  evidenceRequirements: string[];
  confirmedAt: string | null;
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
  scopes: ScopeVersion[];
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
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [exceptionLabel, setExceptionLabel] = useState('');
  const [exceptionDetail, setExceptionDetail] = useState('');

  // Section 5.4 "offline support" — checklist ticks queue locally with no
  // connection at all. Evidence needs a connection to actually upload the
  // file to storage (see lib/upload.ts), but a dropped response on the
  // metadata submission *after* a successful upload still queues and syncs
  // automatically once one comes back (see lib/offlineQueue and
  // submitEvidence() below).
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

  // #53 — a manual GPS ping while working a job, same offline handling as
  // toggleTask/submitEvidence: queued locally on a network failure,
  // replayed automatically once back online. Unlike check-in (one point in
  // time), this can be tapped repeatedly through the job, so it carries
  // its own idempotencyKey — a queued ping replayed after a dropped
  // response updates the ops "active agents" feed exactly once, not twice.
  async function reportLocation(assignmentId: string) {
    if (!detail) return;
    if (!navigator.geolocation) {
      setError('Location is not available on this device');
      return;
    }
    setBusy('location');
    setError(null);

    const position = await new Promise<GeolocationPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 10000, enableHighAccuracy: true });
    });
    if (!position) {
      setError("Couldn't get a GPS fix — try again somewhere with a clearer signal");
      setBusy(null);
      return;
    }

    const path = `/assignments/${assignmentId}/location`;
    const body = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      capturedAt: new Date(position.timestamp).toISOString(),
      idempotencyKey: crypto.randomUUID(),
    };

    try {
      await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
    } catch (err) {
      if (!isNetworkFailure(err)) {
        setError(err instanceof Error ? err.message : 'Action failed');
      } else {
        enqueue({ kind: 'location', caseId: detail.id, path, body });
        refreshQueue();
      }
    } finally {
      setBusy(null);
    }
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
    if (!detail || !evidenceFile) return;
    const path = `/cases/${detail.id}/evidence`;
    setBusy('evidence');
    setError(null);

    // Uploading the file itself needs a connection no queue can fake — the
    // bytes have to actually land in storage. What the offline queue still
    // protects is the metadata submission *after* that upload succeeds: a
    // dropped response there is a lost network blip, not a lost file.
    let storageKey: string;
    try {
      storageKey = await uploadFile('evidence', detail.id, evidenceFile);
    } catch (err) {
      setError(
        isNetworkFailure(err)
          ? "Couldn't upload while offline — try again once you have a connection. The file wasn't lost, just not sent yet."
          : err instanceof Error ? err.message : 'Upload failed',
      );
      setBusy(null);
      return;
    }

    // Same key on the first attempt and any offline-queue replay of it, so
    // a dropped response never creates a duplicate Evidence row server-side.
    const body = {
      type: evidenceType,
      description: evidenceDescription || undefined,
      storageKey,
      clientRequestId: crypto.randomUUID(),
    };
    try {
      await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
      setEvidenceDescription('');
      setEvidenceFile(null);
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
        setEvidenceFile(null);
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
  // The job card is only ever the latest *confirmed* scope version — an
  // unconfirmed revision (e.g. proposed mid-fieldwork) must never present
  // to the agent as binding (Section 14 "cannot silently expand
  // execution"). `scopes` is already ordered newest-first.
  const confirmedScope = detail.scopes.find((s) => s.confirmedAt);

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
            {assignment.checkInAt && canWork && (
              <button className="btn btn--secondary" disabled={busy !== null} onClick={() => reportLocation(assignment.id)}>
                {busy === 'location' ? 'Sending location…' : 'Update my location'}
              </button>
            )}
          </div>
        </div>
      )}

      {confirmedScope && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Job card</h2>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            What the customer confirmed (version {confirmedScope.version}) — do exactly this, nothing more.
          </p>
          <p>{confirmedScope.objective}</p>
          {confirmedScope.tasks.length > 0 && (
            <>
              <strong>Scoped tasks</strong>
              <ul>
                {confirmedScope.tasks.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </>
          )}
          {confirmedScope.evidenceRequirements.length > 0 && (
            <>
              <strong>Evidence required</strong>
              <ul>
                {confirmedScope.evidenceRequirements.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </>
          )}
          {confirmedScope.exclusions.length > 0 && (
            <>
              <strong>Out of scope — do not attempt</strong>
              <ul>
                {confirmedScope.exclusions.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {detail.serviceType === 'CONSTRUCTION_SUPERVISION' && <MilestoneProgress tasks={detail.tasks} />}

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
                {e.viewUrl && (
                  <>
                    {' '}
                    <a href={e.viewUrl} target="_blank" rel="noreferrer">view</a>
                  </>
                )}
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
              type="file"
              accept="image/*,video/*,audio/*,.pdf"
              onChange={(e) => setEvidenceFile(e.target.files?.[0] ?? null)}
            />
            <button
              className="btn"
              style={{ alignSelf: 'flex-start' }}
              disabled={!evidenceFile || busy !== null}
              onClick={submitEvidence}
            >
              {busy === 'evidence' ? 'Uploading…' : 'Add evidence'}
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
