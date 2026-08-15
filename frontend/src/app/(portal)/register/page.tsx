'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, setSession } from '@/lib/api';

// Section 5.1 onboarding: name, country of residence, phone/email,
// preferred channel only — nothing more up front (progressive disclosure).
function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [countryOfResidence, setCountryOfResidence] = useState('United Kingdom');
  const [preferredChannel, setPreferredChannel] = useState('whatsapp');
  const [referralCode, setReferralCode] = useState('');
  const [partnerCode, setPartnerCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Section 12 P1 referral flow — a shared link like /register?ref=CODE
  // pre-fills the field rather than requiring it to be typed in. Section 12
  // P2 partner portal does the same with /register?partner=CODE.
  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref) setReferralCode(ref);
    const partner = searchParams.get('partner');
    if (partner) setPartnerCode(partner);
  }, [searchParams]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await apiFetch<{
        user: { id: string; email: string; role: string };
        accessToken: string;
        refreshToken: string;
      }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          fullName,
          email,
          phone: phone || undefined,
          password,
          countryOfResidence,
          preferredChannel,
          referralCode: referralCode || undefined,
          partnerCode: partnerCode || undefined,
        }),
      });
      setSession(result.accessToken, result.refreshToken, result.user);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: '32rem', margin: '0 auto' }}>
      <h1>Create your ASOJU account</h1>
      <p className="muted">Takes about a minute. We&apos;ll ask for more only when it&apos;s needed for a specific service.</p>
      <form onSubmit={onSubmit}>
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Phone (optional)
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44..." />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <label>
          Country of residence
          <select value={countryOfResidence} onChange={(e) => setCountryOfResidence(e.target.value)}>
            <option>United Kingdom</option>
            <option>United States</option>
            <option>Canada</option>
            <option>Other</option>
          </select>
        </label>
        <label>
          Preferred channel
          <select value={preferredChannel} onChange={(e) => setPreferredChannel(e.target.value)}>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
          </select>
        </label>
        <label>
          Referral code (optional)
          <input value={referralCode} onChange={(e) => setReferralCode(e.target.value.toUpperCase())} />
        </label>
        <label>
          Partner code (optional)
          <input value={partnerCode} onChange={(e) => setPartnerCode(e.target.value.toUpperCase())} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}
