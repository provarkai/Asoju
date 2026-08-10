'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiFetch, clearSession, getSessionUser } from '@/lib/api';

interface EnrollResponse {
  secret: string;
  otpAuthUrl: string;
}

/**
 * Security hardening (independent readiness review, P0-06) — MFA
 * enrollment and session revocation, self-service for whoever is signed
 * in. Renders wherever it's dropped in (currently /profile); a
 * staff-facing settings page would reuse it unchanged once one exists.
 */
export function SecuritySettings({ mfaEnabled: initialMfaEnabled }: { mfaEnabled: boolean }) {
  const [mfaEnabled, setMfaEnabled] = useState(initialMfaEnabled);

  // The parent learns the real value from an async /auth/me fetch that
  // resolves after this component's first render — useState's initial
  // value only applies on mount, so without this the badge stays stuck on
  // whatever it was (false) the instant this component first mounted.
  useEffect(() => {
    setMfaEnabled(initialMfaEnabled);
  }, [initialMfaEnabled]);
  const [enrollment, setEnrollment] = useState<EnrollResponse | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisable, setShowDisable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function startEnroll() {
    setBusy('enroll');
    setError(null);
    try {
      const res = await apiFetch<EnrollResponse>('/auth/mfa/enroll', { method: 'POST' });
      setEnrollment(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start MFA enrollment');
    } finally {
      setBusy(null);
    }
  }

  async function confirmEnroll(e: FormEvent) {
    e.preventDefault();
    setBusy('confirm');
    setError(null);
    try {
      await apiFetch('/auth/mfa/confirm', { method: 'POST', body: JSON.stringify({ code: confirmCode }) });
      setMfaEnabled(true);
      setEnrollment(null);
      setConfirmCode('');
      setMessage('Two-factor authentication is on.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect code');
    } finally {
      setBusy(null);
    }
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    setBusy('disable');
    setError(null);
    try {
      await apiFetch('/auth/mfa/disable', { method: 'POST', body: JSON.stringify({ password: disablePassword }) });
      setMfaEnabled(false);
      setShowDisable(false);
      setDisablePassword('');
      setMessage('Two-factor authentication is off.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect password');
    } finally {
      setBusy(null);
    }
  }

  async function signOutEverywhere() {
    setBusy('logout-all');
    setError(null);
    try {
      await apiFetch('/auth/logout-all', { method: 'POST' });
      clearSession();
      window.location.href = '/login';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign out other sessions');
      setBusy(null);
    }
  }

  const email = getSessionUser()?.email ?? '';

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Security</h2>
      {message && <p className="muted">{message}</p>}
      {error && <p className="error-text">{error}</p>}

      <div style={{ marginBottom: '1.25rem' }}>
        <strong>Two-factor authentication</strong>{' '}
        <span className="badge">{mfaEnabled ? 'On' : 'Off'}</span>
        <p className="muted" style={{ marginTop: '0.3rem' }}>
          Requires a code from an authenticator app (Google Authenticator, 1Password, Authy…) in addition to your
          password when you sign in.
        </p>

        {!mfaEnabled && !enrollment && (
          <button className="btn" disabled={busy !== null} onClick={startEnroll}>
            {busy === 'enroll' ? 'Starting…' : 'Turn on two-factor authentication'}
          </button>
        )}

        {enrollment && (
          <form onSubmit={confirmEnroll} style={{ maxWidth: '28rem' }}>
            <p>
              Add this account to your authenticator app, then enter the 6-digit code it shows.{' '}
              <span className="muted">
                Can&apos;t scan a QR code here — paste this secret manually: <code>{enrollment.secret}</code>
              </span>
            </p>
            <label>
              Code
              <input
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                required
              />
            </label>
            <button className="btn" type="submit" disabled={busy !== null || confirmCode.length !== 6}>
              {busy === 'confirm' ? 'Confirming…' : 'Confirm & turn on'}
            </button>
          </form>
        )}

        {mfaEnabled && !showDisable && (
          <button className="btn btn--ghost" disabled={busy !== null} onClick={() => setShowDisable(true)}>
            Turn off two-factor authentication
          </button>
        )}
        {mfaEnabled && showDisable && (
          <form onSubmit={disable} style={{ maxWidth: '24rem' }}>
            <label>
              Confirm your password
              <input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                required
              />
            </label>
            <div className="actions-row">
              <button className="btn btn--secondary" type="submit" disabled={busy !== null}>
                {busy === 'disable' ? 'Turning off…' : 'Confirm'}
              </button>
              <button className="btn btn--ghost" type="button" onClick={() => setShowDisable(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <div>
        <strong>Sessions</strong>
        <p className="muted" style={{ marginTop: '0.3rem' }}>
          Signed in as {email}. If you think another device is signed in that shouldn&apos;t be, sign out
          everywhere — you&apos;ll need to sign back in here too.
        </p>
        <button className="btn btn--ghost" disabled={busy !== null} onClick={signOutEverywhere}>
          {busy === 'logout-all' ? 'Signing out…' : 'Sign out of every device'}
        </button>
      </div>
    </div>
  );
}
