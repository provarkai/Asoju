'use client';

import { FormEvent, Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Loader2 } from 'lucide-react';
import { apiFetch, setSession } from '@/lib/api';
import { landingPathForRole } from '@/lib/roles';
import { AuthBrandPanel, AuthMobileLogo } from '@/components/auth/AuthBrandPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

// Same real auth (email+password, self-rolled JWT, TOTP MFA) as before —
// this conversion only replaces the visual design (asoju-app-main's
// split brand-panel layout) with the underlying logic untouched. The
// prototype's own auth page used passwordless email-OTP + an anonymous
// guest login via Convex Auth — neither exists in this backend and
// building them was explicitly out of scope for this pass.
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  const [enrollmentToken, setEnrollmentToken] = useState<string | null>(null);
  const [enrollmentSecret, setEnrollmentSecret] = useState<string | null>(null);
  const [enrollmentCode, setEnrollmentCode] = useState('');

  function afterSignIn(role: string) {
    const returnTo = searchParams.get('returnTo');
    const target = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : landingPathForRole(role);
    router.push(target);
  }

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
        afterSignIn(result.user.role);
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
        afterSignIn(result.user.role);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect code');
    } finally {
      setLoading(false);
    }
  }

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
        afterSignIn(result.user.role);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect code');
    } finally {
      setLoading(false);
    }
  }

  if (enrollmentToken) {
    if (!enrollmentSecret) {
      apiFetch<EnrollmentStartResult>('/auth/mfa/enrollment-required/start', {
        method: 'POST',
        body: JSON.stringify({ enrollmentToken }),
      })
        .then((res) => setEnrollmentSecret(res.secret))
        .catch((err) => setError(err instanceof Error ? err.message : 'Failed to start MFA enrollment'));
    }

    return (
      <AuthCard title="Set up two-factor authentication" description="Your role requires two-factor authentication before you can sign in.">
        {enrollmentSecret ? (
          <form onSubmit={onSubmitEnrollment} className="space-y-4">
            <p className="text-sm text-forest/60">
              Add this account to your authenticator app (Google Authenticator, 1Password, Authy…), or paste this
              secret manually: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{enrollmentSecret}</code>
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="enrollmentCode">Code</Label>
              <Input
                id="enrollmentCode"
                value={enrollmentCode}
                onChange={(e) => setEnrollmentCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                required
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full bg-forest text-ivory hover:bg-forest-deep" disabled={loading || enrollmentCode.length !== 6}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : 'Confirm & sign in'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setEnrollmentToken(null);
                setEnrollmentSecret(null);
                setEnrollmentCode('');
                setError(null);
              }}
            >
              Back
            </Button>
          </form>
        ) : (
          <>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <p className="text-sm text-forest/60">Starting enrollment…</p>
          </>
        )}
      </AuthCard>
    );
  }

  if (mfaToken) {
    return (
      <AuthCard title="Enter your code" description="Open your authenticator app and enter the 6-digit code for ASOJU.">
        <form onSubmit={onSubmitMfa} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mfaCode">Code</Label>
            <Input id="mfaCode" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} inputMode="numeric" maxLength={6} required autoFocus />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full bg-forest text-ivory hover:bg-forest-deep" disabled={loading || mfaCode.length !== 6}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : 'Verify & sign in'}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => setMfaToken(null)}>
            Back
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Sign in" description="Welcome back — enter your details to continue.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full bg-forest text-ivory hover:bg-forest-deep" disabled={loading}>
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              Sign in
              <ArrowRight className="size-4" />
            </>
          )}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-forest/55">
        <Link href="/forgot-password" className="underline hover:text-forest">
          Forgot your password?
        </Link>
      </p>
      <p className="mt-2 text-center text-sm text-forest/55">
        New to ASOJU?{' '}
        <Link href="/register" className="font-medium text-forest underline hover:text-forest-deep">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}

function AuthCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <AuthMobileLogo />
        <Card className="border-forest/10 shadow-lg shadow-forest/5">
          <CardHeader>
            <CardTitle className="font-display text-2xl text-forest">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="aam-page flex min-h-screen bg-ivory">
      <AuthBrandPanel />
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
