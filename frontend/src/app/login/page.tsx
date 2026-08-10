'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, setSession } from '@/lib/api';
import { landingPathForRole } from '@/lib/roles';

interface LoginResult {
  mfaRequired?: boolean;
  mfaToken?: string;
  mfaEnrollmentRequired?: boolean;
  enrollmentToken?: string;
  user?: { id: string; email: string; role: string };
  accessToken?: string;
  refreshToken?: string;
}

interface EnrollmentStartResult {
  secret: string;
  otpAuthUrl: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Security hardening — set once password check succeeds on an account
  // with MFA enabled; the form below switches to asking for the code
  // instead of completing sign-in.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  // "Privileged Admin accounts should require MFA" — set instead of
  // mfaToken when the account is a privileged role that hasn't enrolled
  // yet. There is no session at all until enrollment completes.
  const [enrollmentToken, setEnrollmentToken] = useState<string | null>(null);
  const [enrollmentSecret, setEnrollmentSecret] = useState<string | null>(null);
  const [enrollmentCode, setEnrollmentCode] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await apiFetch<LoginResult>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (result.mfaEnrollmentRequired && result.enrollmentToken) {
        setEnrollmentToken(result.enrollmentToken);
        return;
      }
      if (result.mfaRequired && result.mfaToken) {
        setMfaToken(result.mfaToken);
        return;
      }
      if (result.user && result.accessToken && result.refreshToken) {
        setSession(result.accessToken, result.refreshToken, result.user);
        router.push(landingPathForRole(result.user.role));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitMfa(e: FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError(null);
    setLoading(true);
    try {
      const result = await apiFetch<LoginResult>('/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ mfaToken, code: mfaCode }),
      });
      if (result.user && result.accessToken && result.refreshToken) {
        setSession(result.accessToken, result.refreshToken, result.user);
        router.push(landingPathForRole(result.user.role));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect code');
    } finally {
      setLoading(false);
    }
  }

  // Kicks off automatically once an enrollmentToken shows up — the QR/
  // secret is needed before the customer can even attempt a code, so
  // there's nothing to gate behind an extra click.
  useEffect(() => {
    if (!enrollmentToken || enrollmentSecret) return;
    apiFetch<EnrollmentStartResult>('/auth/mfa/enrollment-required/start', {
      method: 'POST',
      body: JSON.stringify({ enrollmentToken }),
    })
      .then((res) => setEnrollmentSecret(res.secret))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to start MFA enrollment'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollmentToken]);

  async function onSubmitEnrollment(e: FormEvent) {
    e.preventDefault();
    if (!enrollmentToken) return;
    setError(null);
    setLoading(true);
    try {
      const result = await apiFetch<LoginResult>('/auth/mfa/enrollment-required/confirm', {
        method: 'POST',
        body: JSON.stringify({ enrollmentToken, code: enrollmentCode }),
      });
      if (result.user && result.accessToken && result.refreshToken) {
        setSession(result.accessToken, result.refreshToken, result.user);
        router.push(landingPathForRole(result.user.role));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect code');
    } finally {
      setLoading(false);
    }
  }

  if (enrollmentToken) {
    return (
      <div className="card" style={{ maxWidth: '28rem', margin: '0 auto' }}>
        <h1>Set up two-factor authentication</h1>
        <p className="muted">
          Your role requires two-factor authentication before you can sign in. Add this account to your
          authenticator app (Google Authenticator, 1Password, Authy…), then enter the 6-digit code it shows.
        </p>
        {enrollmentSecret ? (
          <form onSubmit={onSubmitEnrollment}>
            <p className="muted">
              Can&apos;t scan a QR code here — paste this secret manually: <code>{enrollmentSecret}</code>
            </p>
            <label>
              Code
              <input
                value={enrollmentCode}
                onChange={(e) => setEnrollmentCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                required
                autoFocus
              />
            </label>
            {error && <p className="error-text">{error}</p>}
            <button className="btn" type="submit" disabled={loading || enrollmentCode.length !== 6}>
              {loading ? 'Confirming…' : 'Confirm & sign in'}
            </button>
          </form>
        ) : (
          <>
            {error && <p className="error-text">{error}</p>}
            <p className="muted">Starting enrollment…</p>
          </>
        )}
        <button
          className="btn btn--ghost"
          style={{ marginTop: '0.75rem' }}
          onClick={() => {
            setEnrollmentToken(null);
            setEnrollmentSecret(null);
            setEnrollmentCode('');
            setError(null);
          }}
        >
          Back
        </button>
      </div>
    );
  }

  if (mfaToken) {
    return (
      <div className="card" style={{ maxWidth: '28rem', margin: '0 auto' }}>
        <h1>Enter your code</h1>
        <p className="muted">Open your authenticator app and enter the 6-digit code for ASOJU.</p>
        <form onSubmit={onSubmitMfa}>
          <label>
            Code
            <input
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              inputMode="numeric"
              maxLength={6}
              required
              autoFocus
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn" type="submit" disabled={loading || mfaCode.length !== 6}>
            {loading ? 'Verifying…' : 'Verify & sign in'}
          </button>
        </form>
        <button className="btn btn--ghost" style={{ marginTop: '0.75rem' }} onClick={() => setMfaToken(null)}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: '28rem', margin: '0 auto' }}>
      <h1>Sign in</h1>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <Link href="/forgot-password" className="muted" style={{ display: 'inline-block', marginTop: '0.75rem' }}>
        Forgot your password?
      </Link>
    </div>
  );
}
