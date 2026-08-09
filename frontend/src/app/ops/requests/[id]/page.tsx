'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useOpsGuard } from '@/lib/useOpsGuard';
import { humanServiceType } from '@/lib/case-status';

interface ServiceRequestFull {
  id: string;
  customerId: string;
  rawDescription: string;
  location: string | null;
  channel: string;
  convertedCaseId: string | null;
}

interface Beneficiary { id: string; fullName: string }
interface Property { id: string; address: string }
interface Asset { id: string; assetType: string }

const SERVICE_TYPES = ['PROPERTY_INSPECTION', 'CONSTRUCTION_SUPERVISION', 'ASSET_INSPECTION'];

export default function ConvertRequestPage() {
  const { ready } = useOpsGuard();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [request, setRequest] = useState<ServiceRequestFull | null>(null);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [serviceType, setServiceType] = useState(SERVICE_TYPES[0]);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [riskLevel, setRiskLevel] = useState('2');
  const [beneficiaryId, setBeneficiaryId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [assetId, setAssetId] = useState('');

  useEffect(() => {
    if (!ready) return;
    apiFetch<ServiceRequestFull[]>('/service-requests').then((all) => {
      const found = all.find((r) => r.id === params.id);
      if (!found) {
        setError('Request not found in the triage queue (already converted?)');
        return;
      }
      setRequest(found);
      setDescription(found.rawDescription);
      setLocation(found.location ?? '');
      apiFetch<Beneficiary[]>(`/customers/${found.customerId}/beneficiaries`).then(setBeneficiaries).catch(() => {});
      apiFetch<Property[]>(`/customers/${found.customerId}/properties`).then(setProperties).catch(() => {});
      apiFetch<Asset[]>(`/customers/${found.customerId}/assets`).then(setAssets).catch(() => {});
    }).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load request'));
  }, [ready, params.id]);

  async function onSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiFetch<{ id: string }>(`/service-requests/${params.id}/convert`, {
        method: 'POST',
        body: JSON.stringify({
          serviceType,
          description,
          location,
          riskLevel: Number(riskLevel),
          beneficiaryId: beneficiaryId || undefined,
          propertyId: propertyId || undefined,
          assetId: assetId || undefined,
        }),
      });
      router.push(`/ops/cases/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to convert request');
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) return null;
  if (error && !request) return <p className="error-text">{error}</p>;
  if (!request) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="hero">
        <h1>Convert to case</h1>
        <p className="muted">Original request: &ldquo;{request.rawDescription}&rdquo; via {request.channel}</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', maxWidth: '32rem' }}>
          <label>
            Service
            <select value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
              {SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>{humanServiceType(s)}</option>
              ))}
            </select>
          </label>
          <label>
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label>
            Location
            <input value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
          <label>
            Risk level (1-4)
            <input type="number" min={1} max={4} value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)} />
          </label>

          {beneficiaries.length > 0 && (
            <label>
              Link a beneficiary (optional)
              <select value={beneficiaryId} onChange={(e) => setBeneficiaryId(e.target.value)}>
                <option value="">None</option>
                {beneficiaries.map((b) => <option key={b.id} value={b.id}>{b.fullName}</option>)}
              </select>
            </label>
          )}
          {properties.length > 0 && (
            <label>
              Link a saved property (optional)
              <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                <option value="">None</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.address}</option>)}
              </select>
            </label>
          )}
          {assets.length > 0 && (
            <label>
              Link a saved asset (optional)
              <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                <option value="">None</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.assetType}</option>)}
              </select>
            </label>
          )}

          <button className="btn" disabled={submitting} onClick={onSubmit} style={{ alignSelf: 'flex-start' }}>
            {submitting ? 'Creating case…' : 'Create case'}
          </button>
        </div>
      </div>
    </div>
  );
}
