'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  FilePlus2,
  HardHat,
  HeartHandshake,
  Home,
  Loader2,
  MapPin,
  MessageCircle,
  PackageSearch,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ConciergeChat } from '@/components/ConciergeChat';

type ServiceType =
  | 'PROPERTY_INSPECTION'
  | 'CONSTRUCTION_SUPERVISION'
  | 'ASSET_INSPECTION'
  | 'FAMILY_SUPPORT'
  | 'PROCUREMENT'
  | 'BUSINESS_VERIFICATION'
  | 'INVESTMENT_SUPPORT'
  | 'BEREAVEMENT_SUPPORT';

const SERVICES: { type: ServiceType; icon: typeof Home; name: string; desc: string; from: number; popular: boolean }[] = [
  { type: 'PROPERTY_INSPECTION', icon: Home, name: 'Property Inspection & Verification', desc: 'Found a land or property? We go and check it.', from: 85000, popular: true },
  { type: 'CONSTRUCTION_SUPERVISION', icon: HardHat, name: 'Construction / Project Supervision', desc: "You're building — we watch the site.", from: 125000, popular: false },
  { type: 'ASSET_INSPECTION', icon: PackageSearch, name: 'Asset / Project Inspection', desc: 'House, farm, equipment — we check it.', from: 60000, popular: false },
  { type: 'FAMILY_SUPPORT', icon: Building2, name: 'Family Support Errands', desc: 'Help for the family back home.', from: 45000, popular: false },
  { type: 'PROCUREMENT', icon: PackageSearch, name: 'Procurement & Delivery', desc: 'Buy it there, deliver it, prove it.', from: 30000, popular: false },
  { type: 'BUSINESS_VERIFICATION', icon: Building2, name: 'Business Verification', desc: 'Check that business actually exists.', from: 90000, popular: false },
  { type: 'INVESTMENT_SUPPORT', icon: TrendingUp, name: 'Investment Support', desc: 'Eyes on the ground for your investment.', from: 100000, popular: false },
  { type: 'BEREAVEMENT_SUPPORT', icon: HeartHandshake, name: 'Bereavement & Funeral Logistics', desc: 'We handle the hardest day with care.', from: 150000, popular: false },
];

const TIMELINES = [
  { key: 'immediate', label: 'As soon as possible', hint: 'Urgent — within days' },
  { key: 'near_term', label: 'Within a couple of weeks', hint: 'Steady, no rush' },
  { key: 'exploring', label: 'Just exploring for now', hint: 'Plan & price first' },
] as const;

const PLANS = [
  { key: 'PAY_AS_YOU_GO', label: 'Pay As You Go', desc: 'Pay-per-service. AI intake, verified representative, evidence & report.', icon: ClipboardCheck },
  { key: 'ESSENTIAL', label: 'Essential · $49/mo', desc: '$30 Special Credit monthly + 5% off out-of-pocket cases.', icon: Sparkles },
  { key: 'PRIORITY', label: 'Priority · $99/mo', desc: '$60 Special Credit monthly + 12% off out-of-pocket cases.', icon: Sparkles, badge: 'Best value' },
  { key: 'PREMIUM', label: 'Premium · $199/mo', desc: '$100 Special Credit monthly + 15% off out-of-pocket cases.', icon: Sparkles },
] as const;

const REGIONS = [
  { key: 'LAGOS', label: 'Lagos zone', hint: 'Optimised cost base' },
  { key: 'SOUTH_WEST', label: 'South-West (excl. Lagos)', hint: 'Oyo · Ogun · Osun · Ondo · Ekiti · Kwara' },
  { key: 'OTHER', label: 'Other locations', hint: 'Case-manager scoped · no Special Credit' },
] as const;

const SERVICE_NAME: Record<ServiceType, string> = Object.fromEntries(SERVICES.map((s) => [s.type, s.name])) as Record<ServiceType, string>;

// docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 4 — POST /service-requests
// now accepts serviceType directly from a customer (CreateServiceRequestDto),
// and setting it is what lets a request ever reach an AUTO eligibility
// decision instead of defaulting to CUSTOMER_INPUT. This step already
// collects a real, fixed service selection — send it. priority/tier
// still stay staff-only (ConvertRequestDto, POST
// /service-requests/:id/convert), so region/timeline/plan interest still
// fold into rawDescription for a human to read, same as before.
export default function NewRequestPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [serviceType, setServiceType] = useState<ServiceType | null>(null);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [timeline, setTimeline] = useState<(typeof TIMELINES)[number]['key']>('near_term');
  const [plan, setPlan] = useState<(typeof PLANS)[number]['key']>('PAY_AS_YOU_GO');
  const [region, setRegion] = useState<(typeof REGIONS)[number]['key']>('LAGOS');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 4 — the Concierge chat
  // is now this page's actual first step, not the service-type grid.
  // `chatDone` covers both ways it can resolve: `autoCreated` (the pilot
  // service type's AUTO decision already created a real Case — nothing
  // left for the customer to fill in) or a normal handoff into the
  // step wizard below, pre-filled with the conversation.
  const [showChat, setShowChat] = useState(true);
  const [autoCreated, setAutoCreated] = useState(false);

  // Pre-fill from a Concierge chat draft (carried via sessionStorage when
  // the visitor tried the landing-page demo before signing in — see
  // AiConciergeDemo's CapturedCard / the "request captured" flow). Also
  // skips straight past this page's own chat step in that case — the
  // visitor already had one Concierge conversation pre-login, no need to
  // ask them to repeat it.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('asoju-concierge-draft');
      if (!raw) return;
      sessionStorage.removeItem('asoju-concierge-draft');
      const d = JSON.parse(raw) as Record<string, unknown>;
      if (typeof d.description === 'string') setDescription(d.description);
      if (typeof d.location === 'string') setLocation(d.location);
      setShowChat(false);
    } catch {
      /* malformed draft — ignore */
    }
  }, []);

  const canNext = step === 0 ? serviceType !== null : step === 1 ? description.trim().length >= 10 && location.trim().length > 0 : true;

  const submit = async () => {
    if (!serviceType) return;
    setSubmitting(true);
    setError(null);
    try {
      const regionLabel = REGIONS.find((r) => r.key === region)?.label ?? region;
      const timelineLabel = TIMELINES.find((t) => t.key === timeline)?.label ?? timeline;
      const planLabel = PLANS.find((p) => p.key === plan)?.label ?? plan;
      const fullLocation = [location.trim(), city.trim(), state.trim()].filter(Boolean).join(', ');
      const rawDescription = [
        `Service: ${SERVICE_NAME[serviceType]}`,
        `Region: ${regionLabel}`,
        `Timeline: ${timelineLabel}`,
        plan !== 'PAY_AS_YOU_GO' ? `Interested plan: ${planLabel}` : null,
        '',
        description.trim(),
      ]
        .filter((line) => line !== null)
        .join('\n');

      await apiFetch('/service-requests', {
        method: 'POST',
        body: JSON.stringify({ rawDescription, location: fullLocation, channel: 'web', serviceType }),
      });
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (autoCreated) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl border border-forest/10 bg-white p-8 text-center shadow-lg shadow-forest/5">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-forest/8 text-forest">
          <Sparkles className="size-7" />
        </span>
        <h1 className="mt-5 font-display text-2xl font-semibold text-forest">Your case is already underway</h1>
        <p className="mt-2 text-sm text-forest/60">
          Everything you told the Concierge was enough for us to get started right away — no need to fill
          anything else in. Your team will confirm the details and send a transparent quote shortly.
        </p>
        <Button className="mt-6 bg-forest text-ivory hover:bg-forest-deep" onClick={() => router.push('/dashboard')}>
          View my cases
        </Button>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl border border-forest/10 bg-white p-8 text-center shadow-lg shadow-forest/5">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-forest/8 text-forest">
          <CheckCircle2 className="size-7" />
        </span>
        <h1 className="mt-5 font-display text-2xl font-semibold text-forest">Request received</h1>
        <p className="mt-2 text-sm text-forest/60">
          Our team will review what you&apos;ve told us and get back to you with a transparent quote — usually
          within a business day.
        </p>
        <Button className="mt-6 bg-forest text-ivory hover:bg-forest-deep" onClick={() => router.push('/dashboard')}>
          Back to my dashboard
        </Button>
      </div>
    );
  }

  if (showChat) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-clay">
              <MessageCircle className="size-4" />
              ASOJU Concierge
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold text-forest">What would you like us to handle?</h1>
            <p className="mt-1.5 text-sm text-forest/60">Tell me in your own words — I&apos;ll ask what else we need.</p>
          </div>
          <Badge className="hidden border-gold/40 bg-gold/10 text-clay sm:inline-flex">
            <Sparkles className="size-3" />
            AI-assisted intake
          </Badge>
        </div>

        <div className="mt-6">
          <ConciergeChat
            onAutoCreated={() => setAutoCreated(true)}
            onHandoff={(draft) => {
              setDescription(draft.description);
              setShowChat(false);
            }}
            onSkip={() => setShowChat(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-clay">
            <MessageCircle className="size-4" />
            ASOJU Concierge
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-forest">What would you like us to handle?</h1>
          <p className="mt-1.5 text-sm text-forest/60">A few quick questions — about 2 minutes. Our team takes it from here.</p>
        </div>
        <Badge className="hidden border-gold/40 bg-gold/10 text-clay sm:inline-flex">
          <Sparkles className="size-3" />
          AI-assisted intake
        </Badge>
      </div>

      <div className="mt-6 flex items-center gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-forest/10">
            <div className={cn('h-full rounded-full bg-gradient-to-r from-forest to-gold transition-all duration-500', i <= step ? 'w-full' : 'w-0')} />
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs font-medium text-forest/50">
        {step === 0 ? 'Step 1 of 3 · What do you need handled?' : step === 1 ? "Step 2 of 3 · Tell us where & what's happening" : 'Step 3 of 3 · Timeline & plan interest'}
      </p>

      <div className="mt-6 rounded-3xl border border-forest/10 bg-white p-6 shadow-lg shadow-forest/5 sm:p-8">
        {step === 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {SERVICES.map((s) => (
              <button
                key={s.type}
                onClick={() => setServiceType(s.type)}
                className={cn(
                  'group relative flex flex-col rounded-2xl border p-5 text-left transition-all',
                  serviceType === s.type ? 'border-forest bg-forest text-ivory shadow-lg shadow-forest/20' : 'border-forest/10 bg-white hover:-translate-y-0.5 hover:border-forest/30 hover:shadow-md',
                )}
              >
                {s.popular && (
                  <Badge className={cn('absolute right-4 top-4 border text-[10px]', serviceType === s.type ? 'border-gold/40 bg-gold/15 text-gold-light' : 'border-gold/40 bg-gold/10 text-clay')}>
                    Most popular
                  </Badge>
                )}
                <s.icon className={cn('size-6', serviceType === s.type ? 'text-gold-light' : 'text-forest')} />
                <p className="mt-3 font-display text-base font-semibold">{s.name}</p>
                <p className="mt-1 text-xs opacity-70">{s.desc}</p>
                {/* "from" price intentionally not shown per business decision
                    — a quote is confirmed per case, not advertised as a flat
                    rate. SERVICES[].from still carries the figure. */}
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-forest">Which region is this in?</label>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {REGIONS.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setRegion(r.key)}
                    className={cn('rounded-xl border p-3.5 text-left transition-all', region === r.key ? 'border-forest bg-forest text-ivory shadow-md' : 'border-forest/10 bg-white hover:border-forest/30')}
                  >
                    <p className="text-sm font-semibold">{r.label}</p>
                    <p className={cn('mt-0.5 text-[11px]', region === r.key ? 'opacity-70' : 'text-forest/50')}>{r.hint}</p>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-forest">What&apos;s happening? Describe it in your own words</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="e.g. I found a plot for sale in Ibeju-Lekki and I'm not sure it's genuine. Please check the location, condition and surroundings."
                className="w-full resize-none rounded-xl border border-forest/15 bg-ivory/50 px-4 py-3 text-sm outline-none transition-colors focus:border-forest/40 focus:bg-white"
              />
              <p className="mt-1 text-[11px] text-forest/45">
                {description.trim().length < 10 ? 'Please give us at least a sentence.' : "Thanks — that's enough to triage."}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-forest">
                  <MapPin className="mr-1 inline size-3.5 text-clay" />
                  Location in Nigeria
                </label>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Ibeju-Lekki, Lagos"
                  className="w-full rounded-xl border border-forest/15 bg-ivory/50 px-4 py-2.5 text-sm outline-none transition-colors focus:border-forest/40 focus:bg-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-forest">City</label>
                  <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Lekki" className="w-full rounded-xl border border-forest/15 bg-ivory/50 px-4 py-2.5 text-sm outline-none transition-colors focus:border-forest/40 focus:bg-white" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-forest">State</label>
                  <input value={state} onChange={(e) => setState(e.target.value)} placeholder="Lagos" className="w-full rounded-xl border border-forest/15 bg-ivory/50 px-4 py-2.5 text-sm outline-none transition-colors focus:border-forest/40 focus:bg-white" />
                </div>
              </div>
            </div>
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-800">
              <Camera className="mt-0.5 size-4 shrink-0" />
              Note: our Property Inspection verifies physical location, condition and surroundings with dated
              photo evidence. It is not a legal title certification, survey or valuation — those require a
              licensed professional coordinated through the platform.
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-semibold text-forest">What&apos;s your ideal timeline?</label>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {TIMELINES.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTimeline(t.key)}
                    className={cn('rounded-xl border p-4 text-left transition-all', timeline === t.key ? 'border-forest bg-forest text-ivory shadow-md' : 'border-forest/10 bg-white hover:border-forest/30')}
                  >
                    <p className="text-sm font-semibold">{t.label}</p>
                    <p className={cn('mt-0.5 text-[11px]', timeline === t.key ? 'opacity-70' : 'text-forest/50')}>{t.hint}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-forest">Which plan are you interested in?</label>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {PLANS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPlan(p.key)}
                    className={cn('relative flex gap-3 rounded-xl border p-4 text-left transition-all', plan === p.key ? 'border-forest bg-forest text-ivory shadow-md' : 'border-forest/10 bg-white hover:border-forest/30')}
                  >
                    {'badge' in p && p.badge && (
                      <Badge className={cn('absolute right-3 top-3 border text-[10px]', plan === p.key ? 'border-gold/40 bg-gold/15 text-gold-light' : 'border-gold/40 bg-gold/10 text-clay')}>{p.badge}</Badge>
                    )}
                    <p.icon className={cn('mt-0.5 size-5 shrink-0', plan === p.key ? 'text-gold-light' : 'text-forest')} />
                    <div>
                      <p className="text-sm font-semibold">{p.label}</p>
                      <p className={cn('mt-0.5 text-[11px] leading-relaxed', plan === p.key ? 'opacity-70' : 'text-forest/55')}>{p.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-forest/45">
                This tells our team what you&apos;re interested in — subscribing is a separate step from Billing
                &amp; SC once you&apos;re ready.
              </p>
            </div>
          </div>
        )}

        {error && <p className="error-text mt-4">{error}</p>}

        <div className="mt-8 flex items-center justify-between border-t border-forest/8 pt-5">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="text-forest">
            <ArrowLeft className="size-4" />
            Back
          </Button>
          {step < 2 ? (
            <Button className="bg-forest text-ivory hover:bg-forest-deep" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              Continue
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button className="bg-gold font-semibold text-forest-deep hover:bg-gold-light" disabled={submitting} onClick={submit}>
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                <>
                  <FilePlus2 className="size-4" />
                  Submit request
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-forest/50">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="size-3.5 text-forest" />
          No sensitive IDs (BVN, NIN, passport) requested here
        </span>
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="size-3.5 text-forest" />
          Humans confirm scope &amp; pricing before anything is scheduled
        </span>
      </div>
    </div>
  );
}
