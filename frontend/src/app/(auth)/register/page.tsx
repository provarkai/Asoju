'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Loader2 } from 'lucide-react';
import { apiFetch, setSession } from '@/lib/api';
import { AuthBrandPanel, AuthMobileLogo } from '@/components/auth/AuthBrandPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Same select styling as Input (shadcn doesn't have a plain <select> in
// this app's small component set — Radix Select is overkill for two
// four-option dropdowns).
const selectClassName =
  'border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm';

// Same real registration (POST /auth/register, self-rolled JWT) as
// before — only the visual design changed. Section 5.1 progressive
// disclosure: name, country, phone/email, preferred channel, billing
// currency only.
function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [countryOfResidence, setCountryOfResidence] = useState('United Kingdom');
  const [billingCurrency, setBillingCurrency] = useState('USD');
  const [preferredChannel, setPreferredChannel] = useState('whatsapp');
  const [referralCode, setReferralCode] = useState('');
  const [partnerCode, setPartnerCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        referralCodeApplied?: boolean;
        partnerCodeApplied?: boolean;
      }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          fullName,
          email,
          phone,
          password,
          countryOfResidence,
          billingCurrency,
          preferredChannel,
          referralCode: referralCode || undefined,
          partnerCode: partnerCode || undefined,
        }),
      });
      setSession(result.accessToken, result.refreshToken, result.user);
      // A bad referral/partner code never blocks signup — the account
      // above is already created — but the visitor should still find out
      // it didn't count, rather than assuming it silently worked.
      const unrecognized: string[] = [];
      if (result.referralCodeApplied === false) unrecognized.push('referral code');
      if (result.partnerCodeApplied === false) unrecognized.push('partner code');
      if (unrecognized.length) {
        sessionStorage.setItem(
          'asoju:post-register-notice',
          `We couldn't recognize the ${unrecognized.join(' and ')} you entered, so it wasn't applied to your account. Everything else went through fine.`,
        );
      }
      const returnTo = searchParams.get('returnTo');
      router.push(returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <AuthMobileLogo />
        <Card className="border-forest/10 shadow-lg shadow-forest/5">
          <CardHeader>
            <CardTitle className="font-display text-2xl text-forest">Create your ASOJU account</CardTitle>
            <CardDescription>Takes about a minute. We&apos;ll ask for more only when it&apos;s needed for a specific service.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full name</Label>
                <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44..." required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="country">Country of residence</Label>
                  <select id="country" className={selectClassName} value={countryOfResidence} onChange={(e) => setCountryOfResidence(e.target.value)}>
                    <option>United Kingdom</option>
                    <option>United States</option>
                    <option>Canada</option>
                    <option>Other</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="channel">Preferred channel</Label>
                  <select id="channel" className={selectClassName} value={preferredChannel} onChange={(e) => setPreferredChannel(e.target.value)}>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="currency">Billing currency</Label>
                <select id="currency" className={selectClassName} value={billingCurrency} onChange={(e) => setBillingCurrency(e.target.value)}>
                  <option value="USD">US Dollar ($)</option>
                  <option value="GBP">British Pound (£)</option>
                  <option value="EUR">Euro (€)</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="referralCode">Referral code (optional)</Label>
                  <Input id="referralCode" value={referralCode} onChange={(e) => setReferralCode(e.target.value.toUpperCase())} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="partnerCode">Partner code (optional)</Label>
                  <Input id="partnerCode" value={partnerCode} onChange={(e) => setPartnerCode(e.target.value.toUpperCase())} />
                </div>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full bg-forest text-ivory hover:bg-forest-deep" disabled={loading}>
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    Create account
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </form>
            <p className="mt-4 text-center text-sm text-forest/55">
              Already have an account?{' '}
              <Link href="/login" className="font-medium text-forest underline hover:text-forest-deep">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <div className="aam-page flex min-h-screen bg-ivory">
      <AuthBrandPanel />
      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>
    </div>
  );
}
