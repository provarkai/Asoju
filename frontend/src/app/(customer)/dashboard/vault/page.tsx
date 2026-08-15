'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, FileText, FolderLock, Loader2, Plus, Trash2, UploadCloud } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { uploadVaultFile } from '@/lib/upload';
import { cn } from '@/lib/utils';

interface VaultDocument {
  id: string;
  label: string;
  category: string | null;
  createdAt: string;
  viewUrl: string;
}

function formatSize(bytes?: number) {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const CATEGORIES = ['Title deed', 'CAC certificate', 'Identity', 'Other'];

// Ported from asoju-app-main's VaultView, Documents section only. The
// prototype also had a separate "Power of attorney & verified assets"
// section — customer-submitted items a staff member manually verifies.
// VaultDocument (this backend's model) has no verification workflow,
// and conflating it with the real Asset model (/me/assets — a farm,
// vehicle, etc. used to scope a case, not a document to verify) would
// have been the wrong fit either way. Dropped rather than half-built.
export default function VaultPage() {
  const [documents, setDocuments] = useState<VaultDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<string>('Other');
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    apiFetch<VaultDocument[]>('/me/vault')
      .then(setDocuments)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load your vault'));
  };

  useEffect(load, []);

  const submit = async () => {
    if (!label.trim()) {
      setError('Give the document a name');
      return;
    }
    if (!file) {
      setError('Choose a file to upload');
      return;
    }
    setBusy('add');
    setError(null);
    try {
      const storageKey = await uploadVaultFile(file);
      await apiFetch('/me/vault', { method: 'POST', body: JSON.stringify({ label: label.trim(), category, storageKey }) });
      setLabel('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setShowAdd(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this document from your vault?')) return;
    setBusy('del');
    setError(null);
    try {
      await apiFetch(`/me/vault/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-clay">
            <FolderLock className="size-4" />
            My Nigeria vault
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-forest">Your documents, one secure locker</h1>
          <p className="mt-1.5 text-sm text-forest/60">Title deeds, CAC certificates, IDs — stored independently of any case, so they&apos;re ready whenever you need them.</p>
        </div>
        <Button className="bg-forest text-ivory hover:bg-forest-deep" onClick={() => setShowAdd(true)}>
          <Plus className="size-4" />
          Add document
        </Button>
      </div>

      {error && <p className="error-text mt-4">{error}</p>}

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-forest">Documents</h2>
        {documents === null ? (
          <p className="mt-3 text-sm text-forest/50">Loading…</p>
        ) : documents.length === 0 ? (
          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-dashed border-forest/20 bg-white/60 px-5 py-8 text-sm text-forest/50">
            <FileText className="size-5" />
            Nothing here yet — add your first document (PDF, photos, scans) and it&apos;s stored securely with a download link.
          </div>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {documents.map((d) => (
              <div key={d.id} className="rounded-2xl border border-forest/10 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-forest/8 text-forest">
                      <FileText className="size-4.5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-forest">{d.label}</p>
                      <p className="text-[11px] text-forest/45">
                        {d.category ?? 'Other'} · {new Date(d.createdAt).toLocaleDateString('en-GB')}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 border-t border-forest/8 pt-3">
                  <a
                    href={d.viewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-lg border border-forest/20 px-3 py-1.5 text-xs font-semibold text-forest transition-colors hover:border-forest/50 hover:bg-forest/5"
                  >
                    <Download className="size-3.5" />
                    Download
                  </a>
                  <button
                    type="button"
                    onClick={() => remove(d.id)}
                    disabled={busy === 'del'}
                    className="flex items-center gap-1.5 rounded-lg border border-forest/10 px-3 py-1.5 text-xs font-semibold text-forest/55 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-semibold text-forest">Add a vault document</h3>
            <div className="mt-4 space-y-3">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Deed of assignment — Ibeju-Lekki"
                className="w-full rounded-xl border border-forest/15 bg-ivory/50 px-4 py-2.5 text-sm outline-none focus:border-forest/40"
              />
              <label
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-4 text-sm transition-colors',
                  file ? 'border-forest/40 bg-forest/5 text-forest' : 'border-forest/20 text-forest/60 hover:border-forest/40 hover:bg-ivory/60',
                )}
              >
                <UploadCloud className="size-5 shrink-0" />
                <span className="flex-1">
                  {file ? (
                    <>
                      <span className="block font-semibold">{file.name}</span>
                      <span className="block text-[11px] text-forest/50">{formatSize(file.size)} — tap to choose another</span>
                    </>
                  ) : (
                    <>
                      <span className="block font-medium">Upload a file</span>
                      <span className="block text-[11px] text-forest/50">PDF, photo or scan — stored securely, downloadable anytime</span>
                    </>
                  )}
                </span>
                <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                      category === c ? 'border-forest bg-forest text-ivory' : 'border-forest/15 text-forest/60 hover:border-forest/35',
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button className="bg-forest text-ivory hover:bg-forest-deep" disabled={busy === 'add'} onClick={submit}>
                {busy === 'add' ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
                Upload &amp; save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
