'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await apiFetch<{ message: string; devToken?: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setSent(true);
      // devToken only ever appears outside production (AuthService.forgotPassword)
      // — there's no email provider wired up yet, so this is how the flow
      // is actually testable until one exists.
      if (result.devToken) setDevLink(`/reset-password?token=${result.devToken}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: '28rem', margin: '0 auto' }}>
      <h1>Reset your password</h1>
      {sent ? (
        <>
          <p>If that email exists, we&apos;ve sent a reset link. It expires in 30 minutes.</p>
          {devLink && (
            <p className="muted">
              No email provider is configured yet — here&apos;s the link directly:{' '}
              <Link href={devLink}>{devLink}</Link>
            </p>
          )}
        </>
      ) : (
        <form onSubmit={onSubmit}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <button className="btn" type="submit" disabled={loading}>
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <Link href="/login" className="muted" style={{ display: 'inline-block', marginTop: '0.75rem' }}>
        Back to sign in
      </Link>
    </div>
  );
}
