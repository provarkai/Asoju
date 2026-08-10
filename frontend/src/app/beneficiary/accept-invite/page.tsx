'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, setSession } from '@/lib/api';
import { landingPathForRole } from '@/lib/roles';

interface AcceptInviteResult {
  user: { id: string; email: string; role: string };
  accessToken: string;
  refreshToken: string;
}

// "Who is a Beneficiary" (portal access) — the landing page for the link
// ProfileService.inviteBeneficiary sends. No JwtAuthGuard on the backend
// route: the invite token itself is what authorizes account creation.
function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = searchParams.get('token');
    if (t) setToken(t);
  }, [searchParams]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await apiFetch<AcceptInviteResult>('/auth/beneficiary-invite/accept', {
        method: 'POST',
        body: JSON.stringify({ token, email, password }),
      });
      setSession(result.accessToken, result.refreshToken, result.user);
      router.push(landingPathForRole(result.user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That invite link is invalid or has expired.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: '28rem', margin: '0 auto' }}>
      <h1>Set up your account</h1>
      <p className="muted">
        Someone has invited you to track their ASOJU case with your own sign-in — read-only, just what they&apos;ve
        named you on.
      </p>
      <form onSubmit={onSubmit}>
        <label>
          Invite token
          <input value={token} onChange={(e) => setToken(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Setting up…' : 'Create account'}
        </button>
      </form>
      <Link href="/login" className="muted" style={{ display: 'inline-block', marginTop: '0.75rem' }}>
        Already have an account? Sign in
      </Link>
    </div>
  );
}

export default function AcceptBeneficiaryInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}
