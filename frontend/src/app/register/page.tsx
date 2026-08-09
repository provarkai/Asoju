'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, setSession } from '@/lib/api';

// Section 5.1 onboarding: name, country of residence, phone/email,
// preferred channel only — nothing more up front (progressive disclosure).
export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [countryOfResidence, setCountryOfResidence] = useState('United Kingdom');
  const [preferredChannel, setPreferredChannel] = useState('whatsapp');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        {error && <p className="error-text">{error}</p>}
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
