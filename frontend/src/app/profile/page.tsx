'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { humanCaseStatus, humanServiceType } from '@/lib/case-status';
import { SecuritySettings } from '@/components/SecuritySettings';

interface Beneficiary { id: string; fullName: string; relationship: string | null; phone: string | null }
interface Property { id: string; address: string; city: string | null; state: string | null }
interface Asset { id: string; assetType: string; description: string | null; location: string | null }
interface ReferralSummary { code: string; referredCount: number }
interface SubscriptionSummary {
  status: string;
  tier: string;
  startedAt: string;
  plan: 'PRIORITY' | 'PREMIUM';
  planConfig: { priceUsd: number; scGrantUsd: number; discountPercent: number; eligibleRequestsPerMonth: number };
  scBalanceUsd: number;
  eligibleUsedThisPeriod: number;
  eligibleRemainingThisPeriod: number;
}
interface AccountCaseSummary { id: string; caseNumber: string; serviceType: string; status: string; createdAt: string }
interface AccountMember { id: string; fullName: string; email: string | null; cases: AccountCaseSummary[] }
interface MyAccount { account: { id: string; name: string; type: string }; members: AccountMember[] }
interface SubscriptionInvoice { id: string; periodStart: string; periodEnd: string; amount: string; currency: string; status: string }
interface PlanConfig { plan: 'PRIORITY' | 'PREMIUM'; priceUsd: number; scGrantUsd: number; discountPercent: number; eligibleRequestsPerMonth: number }

// Section 5.1 P1 — "saved properties/assets, multiple beneficiaries".
export default function ProfilePage() {
  const { ready } = useAuthGuard();
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [referral, setReferral] = useState<ReferralSummary | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [planConfigs, setPlanConfigs] = useState<PlanConfig[]>([]);
  const [myAccount, setMyAccount] = useState<MyAccount | null>(null);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [subscribing, setSubscribing] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'PRIORITY' | 'PREMIUM'>('PRIORITY');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preferredChannel, setPreferredChannel] = useState('whatsapp');
  const [savingPreference, setSavingPreference] = useState(false);

  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [beneficiaryRelationship, setBeneficiaryRelationship] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [propertyCity, setPropertyCity] = useState('');
  const [assetType, setAssetType] = useState('');
  const [assetLocation, setAssetLocation] = useState('');

  function load() {
    apiFetch<Beneficiary[]>('/me/beneficiaries').then(setBeneficiaries).catch((e) => setError(e.message));
    apiFetch<Property[]>('/me/properties').then(setProperties).catch((e) => setError(e.message));
    apiFetch<Asset[]>('/me/assets').then(setAssets).catch((e) => setError(e.message));
    apiFetch<ReferralSummary>('/me/referral').then(setReferral).catch((e) => setError(e.message));
    apiFetch<SubscriptionSummary | null>('/me/subscription').then(setSubscription).catch((e) => setError(e.message));
    apiFetch<PlanConfig[]>('/membership-plans').then(setPlanConfigs).catch(() => {});
    apiFetch<MyAccount | null>('/me/account').then(setMyAccount).catch((e) => setError(e.message));
    apiFetch<SubscriptionInvoice[]>('/me/subscription/invoices').then(setInvoices).catch(() => {});
    apiFetch<{ mfaEnabled: boolean }>('/auth/me').then((me) => setMfaEnabled(me.mfaEnabled)).catch(() => {});
    apiFetch<{ preferredChannel: string | null }>('/me/preferences')
      .then((p) => setPreferredChannel(p.preferredChannel ?? 'whatsapp'))
      .catch((e) => setError(e.message));
  }

  async function savePreference(channel: string) {
    setPreferredChannel(channel);
    setSavingPreference(true);
    try {
      await apiFetch('/me/preferences', { method: 'PATCH', body: JSON.stringify({ preferredChannel: channel }) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save preference');
    } finally {
      setSavingPreference(false);
    }
  }

  async function subscribeConcierge() {
    setSubscribing(true);
    try {
      await apiFetch('/me/subscription', { method: 'POST', body: JSON.stringify({ plan: selectedPlan }) });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to subscribe');
    } finally {
      setSubscribing(false);
    }
  }

  async function cancelConcierge() {
    setSubscribing(true);
    try {
      await apiFetch('/me/subscription/cancel', { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel');
    } finally {
      setSubscribing(false);
    }
  }

  function copyReferralLink() {
    if (!referral) return;
    const link = `${window.location.origin}/register?ref=${referral.code}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  useEffect(() => {
    if (ready) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function addBeneficiary(e: FormEvent) {
    e.preventDefault();
    await apiFetch('/me/beneficiaries', {
      method: 'POST',
      body: JSON.stringify({ fullName: beneficiaryName, relationship: beneficiaryRelationship || undefined }),
    });
    setBeneficiaryName('');
    setBeneficiaryRelationship('');
    load();
  }

  async function addProperty(e: FormEvent) {
    e.preventDefault();
    await apiFetch('/me/properties', {
      method: 'POST',
      body: JSON.stringify({ address: propertyAddress, city: propertyCity || undefined }),
    });
    setPropertyAddress('');
    setPropertyCity('');
    load();
  }

  async function addAsset(e: FormEvent) {
    e.preventDefault();
    await apiFetch('/me/assets', {
      method: 'POST',
      body: JSON.stringify({ assetType, location: assetLocation || undefined }),
    });
    setAssetType('');
    setAssetLocation('');
    load();
  }

  async function remove(kind: 'beneficiaries' | 'properties' | 'assets', id: string) {
    await apiFetch(`/me/${kind}/${id}`, { method: 'DELETE' });
    load();
  }

  if (!ready) return null;

  return (
    <div>
      <div className="hero">
        <h1>My Nigeria</h1>
        <p>Save the people and places you look after so you never have to re-describe them.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      <SecuritySettings mfaEnabled={mfaEnabled} />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>ASOJU Concierge — Membership</h2>
        {subscription?.status === 'ACTIVE' ? (
          <>
            <p>
              You&apos;re on <strong>{subscription.plan === 'PREMIUM' ? 'Premium' : 'Priority'}</strong> since{' '}
              {new Date(subscription.startedAt).toLocaleDateString()} — new cases default to
              relationship-managed service.
            </p>
            <div className="actions-row" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div className="card" style={{ flex: '1 1 10rem' }}>
                <div className="muted" style={{ fontSize: '0.8rem' }}>SC balance</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>${subscription.scBalanceUsd.toFixed(2)}</div>
              </div>
              <div className="card" style={{ flex: '1 1 10rem' }}>
                <div className="muted" style={{ fontSize: '0.8rem' }}>Discount on eligible fees</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{subscription.planConfig.discountPercent}%</div>
              </div>
              <div className="card" style={{ flex: '1 1 10rem' }}>
                <div className="muted" style={{ fontSize: '0.8rem' }}>Eligible requests this month</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>
                  {subscription.eligibleRemainingThisPeriod} / {subscription.planConfig.eligibleRequestsPerMonth} left
                </div>
              </div>
            </div>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              SC never becomes cash — it's automatically applied to your next eligible Concierge quote,
              up to what's available. Discount and SC are calculated for you; nothing to redeem manually.
            </p>
            <button className="btn btn--ghost" disabled={subscribing} onClick={cancelConcierge}>
              {subscribing ? 'Cancelling…' : 'Cancel Concierge'}
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              Essential is pay-per-service. Concierge adds a dedicated relationship manager, an SC
              credit, and a discount on eligible fees.
            </p>
            <div className="actions-row" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
              {planConfigs.map((p) => (
                <label
                  key={p.plan}
                  className="card"
                  style={{
                    flex: '1 1 12rem',
                    cursor: 'pointer',
                    borderColor: selectedPlan === p.plan ? 'var(--asoju-green)' : undefined,
                  }}
                >
                  <input
                    type="radio"
                    name="membershipPlan"
                    checked={selectedPlan === p.plan}
                    onChange={() => setSelectedPlan(p.plan)}
                    style={{ marginRight: '0.5rem' }}
                  />
                  <strong>{p.plan === 'PREMIUM' ? 'Premium' : 'Priority'}</strong>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>${p.priceUsd}/mo</div>
                  <div className="muted" style={{ fontSize: '0.85rem' }}>
                    ${p.scGrantUsd} SC · {p.discountPercent}% off eligible fees · up to {p.eligibleRequestsPerMonth} eligible requests/mo
                  </div>
                </label>
              ))}
            </div>
            <button className="btn" disabled={subscribing} onClick={subscribeConcierge}>
              {subscribing ? 'Subscribing…' : `Subscribe to ${selectedPlan === 'PREMIUM' ? 'Premium' : 'Priority'}`}
            </button>
          </>
        )}
        {invoices.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <strong>Billing history</strong>
            {invoices.map((inv) => (
              <div key={inv.id} className="case-row">
                <span className="muted">
                  {new Date(inv.periodStart).toLocaleDateString()} – {new Date(inv.periodEnd).toLocaleDateString()}
                </span>
                <span>{inv.currency} {Number(inv.amount).toLocaleString()}</span>
                <span className={inv.status === 'FAILED' ? 'error-text' : 'badge'}>
                  {inv.status === 'PAID' ? 'Paid' : inv.status === 'FAILED' ? 'Payment failed' : 'Awaiting payment'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Notification preferences</h2>
        <p className="muted">How we reach you when something on a case needs your attention.</p>
        <label>
          Preferred channel
          <select value={preferredChannel} onChange={(e) => savePreference(e.target.value)} disabled={savingPreference}>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
          </select>
        </label>
      </div>

      {referral && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Invite someone</h2>
          <p className="muted">
            Share your code and we&apos;ll know to thank you — {referral.referredCount} friend
            {referral.referredCount === 1 ? ' has' : 's have'} joined so far.
          </p>
          <div className="actions-row">
            <span className="badge" style={{ fontSize: '1rem' }}>{referral.code}</span>
            <button className="btn btn--secondary" onClick={copyReferralLink}>
              {copied ? 'Link copied!' : 'Copy invite link'}
            </button>
          </div>
        </div>
      )}

      {myAccount && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{myAccount.account.name}</h2>
          <p className="muted">
            {myAccount.account.type === 'CORPORATE' ? 'Corporate account' : 'Family account'} —
            what&apos;s being handled for everyone sharing this account. Opening a case still
            requires being that case&apos;s own customer or an assigned collaborator.
          </p>
          {myAccount.members.map((member) => (
            <div key={member.id} style={{ marginTop: '0.75rem' }}>
              <strong>{member.fullName}</strong>{' '}
              <span className="muted">{member.cases.length} case{member.cases.length === 1 ? '' : 's'}</span>
              {member.cases.map((c) => (
                <div key={c.id} className="case-row">
                  <span className="muted">
                    {c.caseNumber} · {humanServiceType(c.serviceType)}
                  </span>
                  <span className="badge">{humanCaseStatus(c.status)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Beneficiaries</h2>
        <p className="muted">Family or others you&apos;re handling things for.</p>
        {beneficiaries.map((b) => (
          <div key={b.id} className="case-row">
            <span>{b.fullName}{b.relationship ? ` (${b.relationship})` : ''}</span>
            <button className="btn btn--ghost" onClick={() => remove('beneficiaries', b.id)}>Remove</button>
          </div>
        ))}
        <form onSubmit={addBeneficiary} style={{ marginTop: '1rem' }}>
          <label>
            Full name
            <input value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} required />
          </label>
          <label>
            Relationship
            <input value={beneficiaryRelationship} onChange={(e) => setBeneficiaryRelationship(e.target.value)} placeholder="e.g. Mother" />
          </label>
          <button className="btn" type="submit">Add beneficiary</button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Properties</h2>
        {properties.map((p) => (
          <div key={p.id} className="case-row">
            <span>{p.address}{p.city ? `, ${p.city}` : ''}</span>
            <button className="btn btn--ghost" onClick={() => remove('properties', p.id)}>Remove</button>
          </div>
        ))}
        <form onSubmit={addProperty} style={{ marginTop: '1rem' }}>
          <label>
            Address
            <input value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} required />
          </label>
          <label>
            City
            <input value={propertyCity} onChange={(e) => setPropertyCity(e.target.value)} />
          </label>
          <button className="btn" type="submit">Add property</button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Assets</h2>
        <p className="muted">Farm, business premises, equipment, vehicle — anything else you need looked after.</p>
        {assets.map((a) => (
          <div key={a.id} className="case-row">
            <span>{a.assetType}{a.location ? ` — ${a.location}` : ''}</span>
            <button className="btn btn--ghost" onClick={() => remove('assets', a.id)}>Remove</button>
          </div>
        ))}
        <form onSubmit={addAsset} style={{ marginTop: '1rem' }}>
          <label>
            Asset type
            <input value={assetType} onChange={(e) => setAssetType(e.target.value)} placeholder="e.g. Farm" required />
          </label>
          <label>
            Location
            <input value={assetLocation} onChange={(e) => setAssetLocation(e.target.value)} />
          </label>
          <button className="btn" type="submit">Add asset</button>
        </form>
      </div>
    </div>
  );
}
