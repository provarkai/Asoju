'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Heart, Home, Loader2, MapPin, Phone, Plus, Save, ShieldCheck, UserRound } from 'lucide-react';
import { apiFetch, getSessionUser } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/portal/ui';

const CHANNELS = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
];

const COUNTRIES = ['United Kingdom', 'United States', 'Canada', 'Germany', 'Other'];

interface Preferences {
  fullName: string | null;
  phone: string | null;
  countryOfResidence: string | null;
  preferredChannel: string | null;
}

interface Property {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  description: string | null;
}

interface Beneficiary {
  id: string;
  fullName: string;
  relationship: string | null;
  phone: string | null;
  notes: string | null;
  userId: string | null;
}

// Ported from asoju-app-main's ProfileView. One real backend extension
// needed: /me/preferences previously only updated preferredChannel —
// register.dto.ts captures fullName/countryOfResidence/phone at signup
// but nothing let a customer edit them afterward. Unlike the other gaps
// found this session (AI quoting, hold/resume, subscription tiers),
// this wasn't a deliberate business-rule boundary, just missing CRUD —
// extended UpdatePreferencesDto rather than dropping the fields from
// this page.
export default function ProfilePage() {
  const sessionUser = getSessionUser();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [propForm, setPropForm] = useState({ address: '', city: '', state: '', description: '' });
  const [benForm, setBenForm] = useState({ fullName: '', relationship: '', phone: '', notes: '' });
  const [adding, setAdding] = useState<string | null>(null);

  const load = () => {
    setError(null);
    Promise.all([apiFetch<Preferences>('/me/preferences'), apiFetch<Property[]>('/me/properties'), apiFetch<Beneficiary[]>('/me/beneficiaries')])
      .then(([p, props, bens]) => {
        setPrefs(p);
        setProperties(props);
        setBeneficiaries(bens);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load your profile'));
  };

  useEffect(load, []);

  if (error && !prefs) return <ErrorState message={error} onRetry={load} />;
  if (!prefs || !properties || !beneficiaries) {
    return <div className="h-64 animate-pulse rounded-3xl bg-forest/5" />;
  }

  const dirty =
    (name !== null && name !== (prefs.fullName ?? '')) ||
    (country !== null && country !== (prefs.countryOfResidence ?? '')) ||
    (phone !== null && phone !== (prefs.phone ?? '')) ||
    (channel !== null && channel !== (prefs.preferredChannel ?? ''));

  const saveProfile = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/me/preferences', {
        method: 'PATCH',
        body: JSON.stringify({
          ...(name !== null ? { fullName: name } : {}),
          ...(country !== null ? { countryOfResidence: country } : {}),
          ...(phone !== null ? { phone } : {}),
          ...(channel !== null ? { preferredChannel: channel } : {}),
        }),
      });
      setName(null);
      setCountry(null);
      setPhone(null);
      setChannel(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const submitProperty = async () => {
    if (!propForm.address.trim()) return;
    setAdding('property');
    setError(null);
    try {
      await apiFetch('/me/properties', {
        method: 'POST',
        body: JSON.stringify({
          address: propForm.address.trim(),
          city: propForm.city.trim() || undefined,
          state: propForm.state.trim() || undefined,
          description: propForm.description.trim() || undefined,
        }),
      });
      setPropForm({ address: '', city: '', state: '', description: '' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setAdding(null);
    }
  };

  const submitBeneficiary = async () => {
    if (!benForm.fullName.trim()) return;
    setAdding('beneficiary');
    setError(null);
    try {
      await apiFetch('/me/beneficiaries', {
        method: 'POST',
        body: JSON.stringify({
          fullName: benForm.fullName.trim(),
          relationship: benForm.relationship.trim() || undefined,
          phone: benForm.phone.trim() || undefined,
          notes: benForm.notes.trim() || undefined,
        }),
      });
      setBenForm({ fullName: '', relationship: '', phone: '', notes: '' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setAdding(null);
    }
  };

  const displayName = prefs.fullName ?? 'ASOJU customer';
  const initials =
    displayName
      .split(' ')
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || 'A';

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-semibold text-clay">Your account</p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-forest">Profile</h1>
        <p className="mt-1.5 text-sm text-forest/60">How we know you, and how we reach you about your cases.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      <section className="rounded-3xl border border-forest/10 bg-white p-6 shadow-sm sm:p-7">
        <div className="flex items-start gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-forest font-display text-xl font-bold text-gold-light">{initials}</span>
          <div>
            <p className="font-display text-xl font-semibold text-forest">{displayName}</p>
            <p className="text-sm text-forest/55">{sessionUser?.email ?? ''}</p>
            <Badge className="mt-2 border-forest/10 bg-forest/5 text-forest/70">
              <ShieldCheck className="size-3" />
              Customer · case-scoped access
            </Badge>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-forest/50">Full name</label>
            <input
              defaultValue={prefs.fullName ?? ''}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-xl border border-forest/15 bg-ivory/50 px-4 py-2.5 text-sm outline-none focus:border-forest/40 focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-forest/50">Country of residence</label>
            <select
              defaultValue={prefs.countryOfResidence ?? 'United Kingdom'}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full rounded-xl border border-forest/15 bg-ivory/50 px-3.5 py-2.5 text-sm outline-none focus:border-forest/40 focus:bg-white"
            >
              {COUNTRIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-forest/50">Phone</label>
            <input
              defaultValue={prefs.phone ?? ''}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+44 …"
              className="w-full rounded-xl border border-forest/15 bg-ivory/50 px-4 py-2.5 text-sm outline-none focus:border-forest/40 focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-forest/50">Preferred channel</label>
            <div className="flex gap-2">
              {CHANNELS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setChannel(c.key)}
                  className={cn(
                    'flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all',
                    (channel ?? prefs.preferredChannel) === c.key ? 'border-forest bg-forest text-ivory' : 'border-forest/15 bg-ivory/50 text-forest/70 hover:border-forest/30',
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button className="bg-forest text-ivory hover:bg-forest-deep" disabled={!dirty || saving} onClick={saveProfile}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save changes
          </Button>
        </div>
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-semibold text-forest">
          <Home className="size-5 text-clay" />
          Saved properties
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {properties.map((prop) => (
            <div key={prop.id} className="rounded-2xl border border-forest/10 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-forest">{prop.address}</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-forest/55">
                <MapPin className="size-3.5" />
                {[prop.city, prop.state].filter(Boolean).join(', ') || 'Nigeria'}
              </p>
              {prop.description && <p className="mt-2 text-xs text-forest/60">{prop.description}</p>}
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-2xl border border-dashed border-forest/25 bg-white/60 p-5">
          <p className="text-sm font-semibold text-forest">Add a property</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              value={propForm.address}
              onChange={(e) => setPropForm({ ...propForm, address: e.target.value })}
              placeholder="Address / description (e.g. Farm plot, Awe)"
              className="w-full rounded-xl border border-forest/15 bg-ivory/50 px-4 py-2.5 text-sm outline-none focus:border-forest/40 focus:bg-white sm:col-span-2"
            />
            <input
              value={propForm.city}
              onChange={(e) => setPropForm({ ...propForm, city: e.target.value })}
              placeholder="City"
              className="w-full rounded-xl border border-forest/15 bg-ivory/50 px-4 py-2.5 text-sm outline-none focus:border-forest/40 focus:bg-white"
            />
            <input
              value={propForm.state}
              onChange={(e) => setPropForm({ ...propForm, state: e.target.value })}
              placeholder="State"
              className="w-full rounded-xl border border-forest/15 bg-ivory/50 px-4 py-2.5 text-sm outline-none focus:border-forest/40 focus:bg-white"
            />
          </div>
          <Button variant="outline" className="mt-3 border-forest/20 text-forest hover:bg-forest hover:text-ivory" disabled={adding === 'property' || !propForm.address.trim()} onClick={submitProperty}>
            {adding === 'property' ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add property
          </Button>
        </div>
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-semibold text-forest">
          <Heart className="size-5 text-clay" />
          Beneficiaries
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {beneficiaries.map((b) => (
            <div key={b.id} className="rounded-2xl border border-forest/10 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-forest">{b.fullName}</p>
                <Badge className="border-forest/10 bg-forest/5 text-[10px] text-forest/60">{b.userId ? 'Portal access' : 'Contact only'}</Badge>
              </div>
              <div className="mt-2 space-y-1 text-xs text-forest/55">
                {b.relationship && (
                  <p className="flex items-center gap-1.5">
                    <UserRound className="size-3.5" /> {b.relationship}
                  </p>
                )}
                {b.phone && (
                  <p className="flex items-center gap-1.5">
                    <Phone className="size-3.5" /> {b.phone}
                  </p>
                )}
              </div>
              {b.notes && <p className="mt-2 text-xs text-forest/60">{b.notes}</p>}
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-2xl border border-dashed border-forest/25 bg-white/60 p-5">
          <p className="text-sm font-semibold text-forest">Add a beneficiary</p>
          <p className="mt-1 text-xs text-forest/55">Someone in Nigeria connected to your cases — e.g. a family member on the ground.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              value={benForm.fullName}
              onChange={(e) => setBenForm({ ...benForm, fullName: e.target.value })}
              placeholder="Full name"
              className="w-full rounded-xl border border-forest/15 bg-ivory/50 px-4 py-2.5 text-sm outline-none focus:border-forest/40 focus:bg-white"
            />
            <input
              value={benForm.relationship}
              onChange={(e) => setBenForm({ ...benForm, relationship: e.target.value })}
              placeholder="Relationship (e.g. Mother)"
              className="w-full rounded-xl border border-forest/15 bg-ivory/50 px-4 py-2.5 text-sm outline-none focus:border-forest/40 focus:bg-white"
            />
            <input
              value={benForm.phone}
              onChange={(e) => setBenForm({ ...benForm, phone: e.target.value })}
              placeholder="Phone"
              className="w-full rounded-xl border border-forest/15 bg-ivory/50 px-4 py-2.5 text-sm outline-none focus:border-forest/40 focus:bg-white"
            />
            <input
              value={benForm.notes}
              onChange={(e) => setBenForm({ ...benForm, notes: e.target.value })}
              placeholder="Notes"
              className="w-full rounded-xl border border-forest/15 bg-ivory/50 px-4 py-2.5 text-sm outline-none focus:border-forest/40 focus:bg-white"
            />
          </div>
          <Button variant="outline" className="mt-3 border-forest/20 text-forest hover:bg-forest hover:text-ivory" disabled={adding === 'beneficiary' || !benForm.fullName.trim()} onClick={submitBeneficiary}>
            {adding === 'beneficiary' ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add beneficiary
          </Button>
        </div>
      </section>
    </div>
  );
}
