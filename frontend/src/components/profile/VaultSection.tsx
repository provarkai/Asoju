'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';

// Section 4.1/4.2 — "My Nigeria" document vault: title deeds, CAC certs,
// IDs, and staff-verified reusable legal assets (e.g. Power of Attorney),
// stored independently of any single case. See backend/src/vault.

const VAULT_CATEGORIES = ['TITLE_DEED', 'CAC_CERT', 'POWER_OF_ATTORNEY', 'IDENTITY', 'OTHER'] as const;
type VaultCategory = (typeof VAULT_CATEGORIES)[number];

const CATEGORY_LABEL: Record<VaultCategory, string> = {
  TITLE_DEED: 'Title deed',
  CAC_CERT: 'CAC certificate',
  POWER_OF_ATTORNEY: 'Power of attorney',
  IDENTITY: 'Identity document',
  OTHER: 'Other',
};

interface VaultDocument {
  id: string;
  name: string;
  category: VaultCategory;
  notes: string | null;
  fileName: string | null;
  fileSize: number | null;
  isVerified: boolean;
  createdAt: string;
  downloadUrl: string | null;
}

interface VerifiedAsset {
  id: string;
  type: VaultCategory;
  name: string;
  verified: boolean;
  notes: string | null;
  createdAt: string;
}

function formatSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function VaultSection() {
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [assets, setAssets] = useState<VerifiedAsset[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [docName, setDocName] = useState('');
  const [docCategory, setDocCategory] = useState<VaultCategory>('OTHER');
  const [docNotes, setDocNotes] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [savingDoc, setSavingDoc] = useState(false);

  const [assetName, setAssetName] = useState('');
  const [assetType, setAssetType] = useState<VaultCategory>('POWER_OF_ATTORNEY');
  const [savingAsset, setSavingAsset] = useState(false);

  function load() {
    apiFetch<VaultDocument[]>('/me/vault-documents').then(setDocuments).catch((e) => setError(e.message));
    apiFetch<VerifiedAsset[]>('/me/verified-assets').then(setAssets).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  async function addDocument(e: FormEvent) {
    e.preventDefault();
    if (!docName.trim()) return;
    setSavingDoc(true);
    setError(null);
    try {
      let storageKey: string | undefined;
      let fileName: string | undefined;
      let fileSize: number | undefined;
      if (docFile) {
        const { storageKey: key, uploadUrl } = await apiFetch<{ storageKey: string; uploadUrl: string }>(
          '/me/vault-documents/upload-url',
          {
            method: 'POST',
            body: JSON.stringify({ fileName: docFile.name, contentType: docFile.type || 'application/octet-stream' }),
          },
        );
        if (!uploadUrl.startsWith('dry-run://')) {
          const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': docFile.type }, body: docFile });
          if (!res.ok) throw new Error('Upload to storage failed — please try again.');
        }
        storageKey = key;
        fileName = docFile.name;
        fileSize = docFile.size;
      }
      await apiFetch('/me/vault-documents', {
        method: 'POST',
        body: JSON.stringify({ name: docName.trim(), category: docCategory, notes: docNotes.trim() || undefined, storageKey, fileName, fileSize }),
      });
      setDocName('');
      setDocNotes('');
      setDocFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSavingDoc(false);
    }
  }

  async function removeDocument(id: string) {
    if (!window.confirm('Delete this document from your vault?')) return;
    try {
      await apiFetch(`/me/vault-documents/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  async function addAsset(e: FormEvent) {
    e.preventDefault();
    if (!assetName.trim()) return;
    setSavingAsset(true);
    setError(null);
    try {
      await apiFetch('/me/verified-assets', {
        method: 'POST',
        body: JSON.stringify({ type: assetType, name: assetName.trim() }),
      });
      setAssetName('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSavingAsset(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>My Nigeria vault</h2>
      <p className="muted">
        Title deeds, CAC certificates, IDs — stored independently of any case, so they&apos;re
        ready whenever you need them.
      </p>
      {error && <p className="error-text">{error}</p>}

      <h3 style={{ marginBottom: '0.5rem' }}>Documents</h3>
      {documents.length === 0 ? (
        <p className="muted">Nothing here yet — add your first document below.</p>
      ) : (
        <div className="case-list">
          {documents.map((d) => (
            <div key={d.id} className="case-row">
              <div className="case-row__meta">
                <strong>{d.name}</strong>
                <span className="muted">
                  {CATEGORY_LABEL[d.category]} · {new Date(d.createdAt).toLocaleDateString('en-GB')}
                  {d.fileName ? ` · ${d.fileName}` : ''}
                  {formatSize(d.fileSize) ? ` · ${formatSize(d.fileSize)}` : ''}
                </span>
              </div>
              <div className="actions-row">
                <span className="badge">{d.isVerified ? 'Verified' : 'Unverified'}</span>
                {d.downloadUrl && (
                  <a href={d.downloadUrl} target="_blank" rel="noreferrer" className="btn btn--ghost">
                    Download
                  </a>
                )}
                <button type="button" className="btn btn--ghost" onClick={() => removeDocument(d.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={addDocument} style={{ marginTop: '1rem' }}>
        <label>
          Document name
          <input
            value={docName}
            onChange={(e) => setDocName(e.target.value)}
            placeholder="e.g. Deed of assignment — Ibeju-Lekki"
            required
          />
        </label>
        <label>
          Category
          <select value={docCategory} onChange={(e) => setDocCategory(e.target.value as VaultCategory)}>
            {VAULT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          File (optional)
          <input ref={fileInputRef} type="file" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
        </label>
        <label>
          Notes (optional)
          <textarea value={docNotes} onChange={(e) => setDocNotes(e.target.value)} rows={2} />
        </label>
        <button className="btn" type="submit" disabled={savingDoc}>
          {savingDoc ? 'Saving…' : docFile ? 'Upload & save' : 'Save to vault'}
        </button>
      </form>

      <h3 style={{ margin: '2rem 0 0.5rem' }}>Power of attorney &amp; verified assets</h3>
      <p className="muted">
        Verified once by our staff, then usable on future cases that require legal execution.
      </p>
      {assets.length === 0 ? (
        <p className="muted">No verified assets yet — submit a PoA and our team verifies it once.</p>
      ) : (
        <div className="case-list">
          {assets.map((a) => (
            <div key={a.id} className="case-row">
              <div className="case-row__meta">
                <strong>{a.name}</strong>
                <span className="muted">{CATEGORY_LABEL[a.type]}</span>
              </div>
              <span className="badge">{a.verified ? 'Staff-verified' : 'Pending review'}</span>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={addAsset} style={{ marginTop: '1rem' }}>
        <label>
          Asset name
          <input
            value={assetName}
            onChange={(e) => setAssetName(e.target.value)}
            placeholder="e.g. Power of attorney — Mrs. Adaeze Okonkwo"
            required
          />
        </label>
        <label>
          Type
          <select value={assetType} onChange={(e) => setAssetType(e.target.value as VaultCategory)}>
            {VAULT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn--secondary" type="submit" disabled={savingAsset}>
          {savingAsset ? 'Submitting…' : 'Submit for verification'}
        </button>
      </form>
    </div>
  );
}
