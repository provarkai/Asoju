'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSessionUser } from '@/lib/api';
import { ConciergeChat } from '@/components/ConciergeChat';
import { ConciergeDemo } from '@/components/landing/ConciergeDemo';

// Section 5.1 — Customer Portal home screen: "What would you like us to
// handle for you in Nigeria?" This is the natural-language entry point
// that routes through the AI Concierge (Section 5.2 / 7.2).
//
// Signed-out visitors get the full marketing landing page below instead.

const SERVICES = [
  {
    icon: '🏠',
    title: 'Property Inspection & Verification',
    copy: "Found a land or property for sale? We go and check it — location, condition, surroundings — and prove what we found with dated photo evidence.",
    tag: 'Most popular',
  },
  {
    icon: '🏗️',
    title: 'Construction / Project Supervision',
    copy: "Building in Nigeria while you're abroad? Our representatives make scheduled site visits and send you progress evidence, so no one can tell you one thing and do another.",
    tag: 'Recurring visits',
  },
  {
    icon: '📦',
    title: 'Asset / Project Inspection',
    copy: "A farm, a business, a vehicle, equipment — if you can't be there to check it, we can. Inspection, evidence, report, recommendation.",
    tag: '',
  },
];

const STEPS = [
  {
    title: 'Tell us what to handle',
    copy: 'Describe what you need done in Nigeria in plain language — the AI Concierge understands and captures the essentials in minutes, not days.',
  },
  {
    title: 'We verify, quote & schedule',
    copy: 'A human team confirms scope, sends a transparent line-item quote, and schedules a vetted representative once you accept.',
  },
  {
    title: 'A trusted presence executes',
    copy: 'Your representative physically goes and does the work — inspections, supervision, errands — capturing dated photo, video and note evidence throughout.',
  },
  {
    title: 'Evidence → QC → your approval',
    copy: 'Every evidence package passes quality control, becomes a plain-language report, and lands in your portal. You approve — you stay in control.',
  },
];

const TRUST_LABELS = [
  { label: 'ASOJU Verified', copy: 'Identity & process verified by ASOJU' },
  { label: 'Professionally Reviewed', copy: 'Reviewed by a qualified professional' },
  { label: 'Customer Provided', copy: 'Information came from you' },
  { label: 'Third-Party Statement', copy: 'Stated by another party — flagged as such' },
  { label: 'Not Independently Verified', copy: 'No independent confirmation yet' },
];

const TESTIMONIALS = [
  {
    name: 'Adaeze O.',
    location: 'London, UK',
    text: "I bought a plot in Ibeju-Lekki without stepping foot in Nigeria. ASOJU's report showed me the access road, the fence, even the neighbour's construction — dated photos of everything. I finally slept well.",
    initials: 'AO',
  },
  {
    name: 'Tunde A.',
    location: 'Houston, USA',
    text: "My contractor said the deck was poured. ASOJU's site visit said otherwise, with video proof. We saved a five-figure mistake. This is the service I wish existed years ago.",
    initials: 'TA',
  },
  {
    name: 'Ngozi E.',
    location: 'Toronto, Canada',
    text: 'I manage my parents\' farm from abroad. Every inspection comes back with clear evidence and a report I actually understand. My mother finally believes I\'m watching over things.',
    initials: 'NE',
  },
];

// Pricing tiers deliberately match what the backend actually supports —
// PAY_AS_YOU_GO has no plan record, PRIORITY/PREMIUM are the two real
// MembershipPlan values (see backend/prisma/schema.prisma). There is no
// "Essential" tier server-side, so this page doesn't advertise one.
// Live $/SC/discount figures are admin-configurable (MembershipPlanConfig)
// and only exposed to authenticated users (GET /membership-plans) — so
// this section stays qualitative rather than quoting numbers that could
// drift from what Finance has actually configured.
const PLANS = [
  {
    name: 'Pay As You Go',
    tagline: 'Pay-per-service',
    price: 'No monthly fee',
    features: [
      'AI Concierge intake & case tracking',
      'Verified representative on site',
      'Photo/video evidence + QC report',
      'Region-based quotes, rate locked 48h',
    ],
    cta: 'Start free',
  },
  {
    name: 'Priority',
    tagline: 'Subscription + Special Credit',
    price: 'See live pricing after sign-up',
    features: [
      'Everything in Pay As You Go',
      'Monthly Special Credit (SC) toward a case',
      'Discount on out-of-pocket overages',
      'Priority scheduling & dedicated queue',
    ],
    cta: 'View Priority plan',
    featured: true,
  },
  {
    name: 'Premium',
    tagline: 'Subscription, relationship-managed',
    price: 'See live pricing after sign-up',
    features: [
      'Everything in Priority',
      'Larger monthly Special Credit (SC)',
      'Deeper discount on overages',
      'Dedicated relationship manager',
    ],
    cta: 'View Premium plan',
    dark: true,
  },
];

function Landing() {
  return (
    <div>
      {/* HERO */}
      <div className="full-bleed">
        <div className="landing-inner landing-hero-grid">
          <div className="landing-fade-up">
            <span className="landing-eyebrow">Diaspora Support Platform</span>
            <h1 className="landing-heading landing-heading--hero">
              Your trusted presence back home.
            </h1>
            <p className="landing-lede">
              You&apos;re in London, Houston or Toronto. Your land, your build, your family&apos;s
              farm is in Lagos, Abuja, Enugu. ASOJU puts a verified human on the ground — with
              evidence — so you never have to wonder what&apos;s really happening back home.
            </p>
            <div className="actions-row" style={{ marginTop: '1.75rem' }}>
              <Link href="/register" className="btn">
                Start a request →
              </Link>
              <a href="#how" className="btn btn--secondary">
                See how it works
              </a>
            </div>
            <div className="landing-trust-row">
              <span>🛡️ Vetted representatives</span>
              <span>📷 Dated photo evidence</span>
              <span>✅ QC before you see it</span>
            </div>
          </div>
          <div className="landing-fade-up">
            <ConciergeDemo signedIn={false} />
          </div>
        </div>
      </div>

      {/* TRUST BAR */}
      <div className="full-bleed landing-section--sand landing-section--tight">
        <div className="landing-inner landing-stat-bar">
          <div>
            <strong>3,200+</strong>
            <span>tasks executed in Nigeria</span>
          </div>
          <div>
            <strong>4.9/5</strong>
            <span>average customer rating</span>
          </div>
          <div>
            <strong>48h</strong>
            <span>median time to first visit</span>
          </div>
          <div>
            <strong>100%</strong>
            <span>evidence-backed reports</span>
          </div>
        </div>
      </div>

      {/* SERVICES */}
      <div id="services" className="landing-inner landing-section">
        <div className="landing-centered">
          <span className="landing-eyebrow">What we handle</span>
          <h2 className="landing-heading">Whatever matters to you back home</h2>
          <p className="landing-lede" style={{ margin: '1rem auto 0' }}>
            Three services at launch — each with a published spec: scope, deliverables, evidence
            and exclusions. No surprises.
          </p>
        </div>
        <div className="landing-grid-3">
          {SERVICES.map((s) => (
            <div className="landing-card" key={s.title}>
              {s.tag && <span className="badge landing-card__tag">{s.tag}</span>}
              <span className="landing-card__icon">{s.icon}</span>
              <h3>{s.title}</h3>
              <p>{s.copy}</p>
            </div>
          ))}
        </div>
        <p className="muted" style={{ textAlign: 'center', marginTop: '2rem' }}>
          Family support, procurement, business verification &amp; investment support roll out
          next. <Link href="/register">Tell us what you need →</Link>
        </p>
      </div>

      {/* HOW IT WORKS */}
      <div id="how" className="full-bleed landing-section--dark landing-section">
        <div className="landing-inner">
          <div className="landing-centered">
            <span className="landing-eyebrow">The golden path</span>
            <h2 className="landing-heading">
              From request to report — deterministic, not hopeful
            </h2>
            <p className="landing-lede" style={{ margin: '1rem auto 0' }}>
              A workflow engine enforces every step. AI may recommend — it never decides for you.
            </p>
          </div>
          <div className="landing-grid-4">
            {STEPS.map((s, i) => (
              <div className="landing-step" key={s.title}>
                <span className="landing-step__num">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* TRUST & EVIDENCE */}
      <div id="trust" className="landing-inner landing-section">
        <div className="landing-trust-grid">
          <div>
            <span className="landing-eyebrow">Trust &amp; evidence</span>
            <h2 className="landing-heading">We never just say &quot;verified&quot;</h2>
            <p className="landing-lede">
              Every claim in every report carries a label that says where it came from and how we
              know. Evidence is captured with server timestamps, reviewed by QC, and can never be
              silently edited.
            </p>
            <ul className="landing-trust-list">
              {TRUST_LABELS.map((t) => (
                <li key={t.label}>
                  <span>✓</span>
                  <div>
                    <strong>{t.label}</strong>
                    <span>{t.copy}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="landing-confidence-card">
              <div className="actions-row" style={{ justifyContent: 'space-between' }}>
                <strong>Case confidence</strong>
                <span className="badge">Delivered</span>
              </div>
              {[
                ['Identity', 'Complete', 100],
                ['Physical inspection', 'Complete', 100],
                ['Documents', 'Partial', 55],
                ['Professional review', 'Pending', 20],
              ].map(([label, state, pct]) => (
                <div className="landing-confidence-row" key={label as string}>
                  <div className="landing-confidence-row__label">
                    <span>{label}</span>
                    <span className="muted">{state}</span>
                  </div>
                  <div className="landing-confidence-track">
                    <div
                      className="landing-confidence-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              ))}
              <div className="landing-confidence-footer">
                <div>
                  <strong>3</strong>
                  <span>photos captured</span>
                </div>
                <div>
                  <strong>1</strong>
                  <span>video walkthrough</span>
                </div>
                <div>
                  <strong>1</strong>
                  <span>QC-approved report</span>
                </div>
              </div>
            </div>
            <div className="landing-nonneg">
              <strong>Non-negotiable:</strong> no payment status from screenshots, no evidence
              without a case, no report that hides unresolved issues.
            </div>
          </div>
        </div>
      </div>

      {/* PRICING */}
      <div id="pricing" className="full-bleed landing-section--sand landing-section">
        <div className="landing-inner">
          <div className="landing-centered">
            <span className="landing-eyebrow">Pricing</span>
            <h2 className="landing-heading">Pay As You Go or Concierge — your call</h2>
            <p className="landing-lede" style={{ margin: '1rem auto 0' }}>
              Transparent, line-item quotes. External costs are never hidden inside service fees.
              Concierge pricing is set by ASOJU Finance and shown live once you&apos;re signed in.
            </p>
          </div>
          <div className="landing-grid-3">
            {PLANS.map((p) => (
              <div
                className={`landing-card ${p.featured ? 'landing-pricing-card--featured' : ''} ${
                  p.dark ? 'landing-pricing-card--dark' : ''
                }`}
                key={p.name}
              >
                {p.featured && <span className="badge landing-card__tag">Best value</span>}
                <h3 style={{ marginTop: 0 }}>{p.name}</h3>
                <p className="landing-card__price">{p.tagline}</p>
                <p className="landing-price">{p.price}</p>
                <ul className="landing-pricing-list">
                  {p.features.map((f) => (
                    <li key={f}>
                      <span>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/register"
                  className={`btn ${p.dark ? 'btn--secondary' : ''}`}
                  style={{ marginTop: '1.5rem', width: '100%' }}
                >
                  {p.cta}
                </Link>
              </div>
            ))}
          </div>
          <p className="muted" style={{ textAlign: 'center', maxWidth: '42rem', margin: '2rem auto 0' }}>
            SC (Special Credit) vouchers are single-use per billing cycle — any unused balance is
            forfeited. The SC voucher and your plan discount are mutually exclusive — applying
            your SC replaces the discount. Quotes lock today&apos;s rate for 48 hours.
          </p>
        </div>
      </div>

      {/* TESTIMONIALS */}
      <div className="landing-inner landing-section">
        <div className="landing-centered">
          <span className="landing-eyebrow">From our customers</span>
          <h2 className="landing-heading">Diaspora, finally at ease</h2>
        </div>
        <div className="landing-grid-3">
          {TESTIMONIALS.map((t) => (
            <figure className="landing-card landing-testimonial" key={t.name}>
              <div className="landing-testimonial__stars">★★★★★</div>
              <blockquote>&ldquo;{t.text}&rdquo;</blockquote>
              <figcaption className="landing-testimonial__who">
                <span className="landing-avatar">{t.initials}</span>
                <div>
                  <strong style={{ display: 'block', fontSize: '0.9rem' }}>{t.name}</strong>
                  <span className="muted">{t.location}</span>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="landing-inner landing-section--tight">
        <div className="landing-cta-band">
          <h2 className="landing-heading" style={{ margin: 0 }}>
            What needs handling back home?
          </h2>
          <p className="landing-lede" style={{ margin: '1rem auto 0', color: 'inherit', opacity: 0.75 }}>
            Tell us in plain words. We&apos;ll get eyes, hands and evidence on it — and you&apos;ll
            approve the result before we call it done.
          </p>
          <div className="actions-row" style={{ justifyContent: 'center', marginTop: '1.75rem' }}>
            <Link href="/register" className="btn" style={{ background: 'var(--asoju-gold)' }}>
              Start a request →
            </Link>
            <Link href="/login" className="btn btn--secondary" style={{ borderColor: 'currentColor', color: 'inherit' }}>
              Talk to us
            </Link>
          </div>
        </div>
      </div>

    </div>
  );
}

export default function HomePage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    setSignedIn(Boolean(getSessionUser()));
  }, []);

  if (signedIn === null) return null;

  if (signedIn) {
    return (
      <div>
        <div className="hero">
          <h1>What would you like us to handle for you in Nigeria?</h1>
          <p>
            Tell us in your own words — property, a construction project, an asset you need
            checked on. We&apos;ll ask a few quick questions and take it from there.
          </p>
        </div>
        <ConciergeChat />
      </div>
    );
  }

  return <Landing />;
}
