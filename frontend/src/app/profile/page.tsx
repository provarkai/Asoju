'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuthGuard } from '@/lib/useAuthGuard';

interface Beneficiary { id: string; fullName: string; relationship: string | null; phone: string | null }
interface Property { id: string; address: string; city: string | null; state: string | null }
interface Asset { id: string; assetType: string; description: string | null; location: string | null }
interface ReferralSummary { code: string; referredCount: number }

// Section 5.1 P1 — "saved properties/assets, multiple beneficiaries".
export default function ProfilePage() {
  const { ready } = useAuthGuard();
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [referral, setReferral] = useState<ReferralSummary | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
