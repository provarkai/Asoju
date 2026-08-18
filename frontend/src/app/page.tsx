'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowRight,
  Building2,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  FileText,
  HandHeart,
  HardHat,
  Home,
  Lock,
  MessageCircle,
  Plane,
  PackageSearch,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Map,
} from 'lucide-react';
import AiConciergeDemo from '@/components/landing/AiConciergeDemo';
import { motion } from 'framer-motion';
import { useAuth } from '@/lib/useAuth';
import { SERVICE_FAMILIES } from '@/lib/services';

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

// One icon per locked service family — homepage-card-only concern, kept
// out of lib/services.ts (display-only per that file's own note) since
// nothing server-side or route-level needs it.
const SERVICE_ICONS: Record<string, typeof Home> = {
  arrivals: Plane,
  inspect: Eye,
  build: HardHat,
  care: HandHeart,
  verify: ShieldCheck,
  assist: PackageSearch,
};

// Locked 4-step copy — docs/frontend-handoff-v1.0/99_Supplemental/
// ASOJU_Homepage_Build_Blueprint_v1.0.docx §4.7 "How ASOJU works" table
// (identical in ASOJU_Homepage_UI_UX_Frontend_Engineering_Spec_v1.0.docx).
const STEPS = [
  {
    icon: MessageCircle,
    title: 'Tell us',
    copy: 'Describe what you need through the ASOJU Concierge.',
  },
  {
    icon: ClipboardCheck,
    title: 'Define it',
    copy: 'ASOJU clarifies the request, scope and requirements.',
  },
  {
    icon: UserCheck,
    title: 'We handle it',
    copy: 'The right people execute the work on the ground.',
  },
  {
    icon: FileText,
    title: 'You see what happened',
    copy: 'Receive updates, evidence and the completed report where applicable.',
  },
];

// Locked "Why ASOJU" 4-pillar message table — same source docs, §4.8 /
// §9 respectively, both citing the identical Pillar/Message pairs.
const WHY_ASOJU_PILLARS = [
  {
    icon: UserCheck,
    title: 'Trusted Representation',
    copy: 'Someone accountable is handling the matter on the ground.',
  },
  {
    icon: Eye,
    title: 'Evidence & Visibility',
    copy: "You don't have to rely on vague updates.",
  },
  {
    icon: ClipboardCheck,
    title: 'Clear Scope & Costs',
    copy: "You know what is being handled and what you're paying for.",
  },
  {
    icon: ShieldCheck,
    title: 'Accountability',
    copy: 'The work moves through a controlled process rather than informal handoffs.',
  },
];

const TRUST_LABELS = [
  { label: 'ASOJU Verified', copy: 'Identity & process verified by ASOJU' },
  { label: 'Professionally Reviewed', copy: 'Reviewed by a qualified professional' },
  { label: 'Customer Provided', copy: 'Information came from you' },
  { label: 'Third-Party Statement', copy: 'Stated by another party — flagged as such' },
  { label: 'Not Independently Verified', copy: 'No independent confirmation yet' },
];

// ASOJU landing — hero, services, golden path, trust, pricing,
// testimonials. Deliberately does NOT use the (portal) route group's
// SiteHeader/.container chrome — it has its own full-width header/nav/
// footer (see app/layout.tsx + app/(portal)/layout.tsx for the split).
export default function Landing() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  const go = (path: string) => router.push(path);
  const startRequest = () => go(isAuthenticated ? '/dashboard/new' : '/register');
  const openBilling = () => go(isAuthenticated ? '/dashboard/billing' : '/register');

  return (
    <div className="aam-page min-h-screen bg-ivory text-foreground overflow-x-hidden">
      {/* ------------------------------------------------------------ NAV */}
      <header className="sticky top-0 z-40 border-b border-forest/10 bg-ivory/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <button onClick={() => go('/')} className="flex items-center gap-2.5" aria-label="ASOJU home">
            <span className="flex size-9 items-center justify-center rounded-lg bg-forest text-gold-light font-display text-lg font-bold shadow-sm">
              A
            </span>
            <span className="font-display text-xl font-semibold tracking-tight text-forest">ASOJU</span>
          </button>
          <nav className="hidden items-center gap-7 text-sm font-medium text-forest/80 md:flex">
            <a href="#services" className="transition-colors hover:text-forest">Services</a>
            <a href="#how" className="transition-colors hover:text-forest">How it works</a>
            <a href="#why" className="transition-colors hover:text-forest">Why ASOJU</a>
            <a href="#trust" className="transition-colors hover:text-forest">Trust</a>
            <a href="#pricing" className="transition-colors hover:text-forest">Pricing</a>
          </nav>
          <div className="flex items-center gap-2.5">
            <Button
              variant="ghost"
              className="text-forest hover:bg-forest/5"
              onClick={() => go(isAuthenticated ? '/dashboard' : '/login')}
            >
              {isAuthenticated ? 'Open portal' : 'Sign in'}
            </Button>
            <Button className="bg-forest text-ivory hover:bg-forest-deep" onClick={startRequest}>
              Get started
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------ HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grain pointer-events-none" />
        <div
          className="pointer-events-none absolute -top-40 right-[-10%] size-[540px] rounded-full opacity-40 blur-3xl"
          style={{ background: 'radial-gradient(circle, #e3b94e55, transparent 65%)' }}
        />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:pt-24">
          <motion.div initial="hidden" animate="show" variants={fadeUp}>
            <Badge className="mb-5 border-gold/40 bg-gold/10 px-3 py-1 text-xs font-semibold text-clay">
              Diaspora Support Platform — serving Nigerians abroad
            </Badge>
            <h1 className="font-display text-5xl font-semibold leading-[1.04] tracking-tight text-forest sm:text-6xl lg:text-[4.2rem]">
              Be there,
              <br />
              even when you <span className="text-gradient-gold">can&apos;t be there</span>.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-forest/70">
              ASOJU helps you handle important things in Nigeria from wherever you are — with trusted people on
              the ground, clear scope, evidence and accountability.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                className="h-12 bg-forest px-6 text-ivory shadow-lg shadow-forest/25 transition-all hover:-translate-y-0.5 hover:bg-forest-deep hover:shadow-xl"
                onClick={startRequest}
              >
                Start with ASOJU
                <ArrowRight className="size-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 border-forest/20 bg-white/60 px-6 text-forest hover:bg-white"
                onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}
              >
                See how it works
              </Button>
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-forest/60">
              <span className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-forest" />
                Vetted representatives
              </span>
              <span className="flex items-center gap-2">
                <Camera className="size-4 text-forest" />
                Dated photo evidence
              </span>
              <span className="flex items-center gap-2">
                <UserCheck className="size-4 text-forest" />
                QC before you see it
              </span>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative mx-auto w-full max-w-lg"
          >
            <p className="mb-3 text-center font-display text-lg font-semibold text-forest lg:text-left">
              Tell ASOJU what you need
            </p>
            <AiConciergeDemo isAuthenticated={isAuthenticated} onNavigate={go} />
          </motion.div>
        </div>
      </section>

      {/* --------------------------------------------------- TRUST STRIP */}
      {/* Positioning/trust statements, not performance metrics — Homepage
          Build Blueprint §4.4 / Homepage UI/UX Spec §5 are explicit that
          this strip is not the place for invented counts/ratings; see
          §10 (Trust/proof) below for where real proof, once it exists,
          belongs. */}
      <section className="border-y border-forest/8 bg-white/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-4 px-4 py-8 sm:px-6">
          {[
            { icon: ShieldCheck, label: 'Trusted representation in Nigeria' },
            { icon: ClipboardCheck, label: 'Clear scope' },
            { icon: UserCheck, label: 'Accountable execution' },
            { icon: Camera, label: 'Evidence-backed updates' },
            { icon: Lock, label: 'Secure payments' },
          ].map(({ icon: Icon, label }) => (
            <span key={label} className="flex items-center gap-2 text-sm font-medium text-forest/70">
              <Icon className="size-4 text-forest" />
              {label}
            </span>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ SERVICES */}
      <section id="services" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          variants={fadeUp}
          className="mx-auto max-w-2xl text-center"
        >
          <Badge className="border-gold/40 bg-gold/10 text-clay">What we handle</Badge>
          <h2 className="mt-4 font-display text-4xl font-semibold text-forest sm:text-5xl">
            Whatever needs someone you trust on the ground.
          </h2>
          <p className="mt-4 text-lg text-forest/65">
            Six service families, each with a published scope, deliverables and evidence policy. No surprises.
          </p>
        </motion.div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_FAMILIES.map((s, i) => {
            const Icon = SERVICE_ICONS[s.slug] ?? Home;
            return (
              <motion.div
                key={s.slug}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, margin: '-60px' }}
                variants={fadeUp}
                custom={i}
                className="group relative overflow-hidden rounded-2xl border border-forest/10 bg-white p-7 shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-forest/10"
              >
                <div className="flex size-12 items-center justify-center rounded-xl bg-forest text-gold-light transition-transform duration-300 group-hover:scale-110">
                  <Icon className="size-6" />
                </div>
                <h3 className="mt-5 font-display text-xl font-semibold text-forest">{s.name}</h3>
                <p className="mt-3 text-sm leading-relaxed text-forest/65">{s.tagline}</p>
                {/* "from" price intentionally not shown per business decision — a
                    quote is confirmed per case, not advertised as a flat rate.
                    ServiceFamily.fromNgn (lib/services.ts) still carries the
                    figure; only this render was removed. */}
                <button
                  onClick={() => go(`/${s.slug}`)}
                  className="mt-5 flex items-center gap-1.5 text-sm font-semibold text-forest underline decoration-gold decoration-2 underline-offset-4 hover:decoration-forest"
                >
                  Explore {s.name}
                  <ArrowRight className="size-3.5" />
                </button>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------ REPRESENTATION */}
      <section className="bg-sand/40 py-24">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }} variants={fadeUp}>
            <Badge className="border-gold/40 bg-gold/10 text-clay">How representation works</Badge>
            <h2 className="mt-4 font-display text-4xl font-semibold text-forest sm:text-5xl">
              Distance shouldn&apos;t mean losing control.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-forest/65">
              You&apos;re abroad, something needs to happen in Nigeria. ASOJU understands what you need, a trusted
              person handles it, and you receive updates and evidence — so you stay informed and in control the
              whole way through.
            </p>
          </motion.div>
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-80px' }}
            variants={fadeUp}
            custom={1}
            className="space-y-3"
          >
            {[
              'You are abroad',
              'Something needs to happen in Nigeria',
              'ASOJU understands what you need',
              'A trusted person handles it',
              'You receive updates and evidence',
              'You stay informed and in control',
            ].map((step, i, arr) => (
              <div key={step} className="flex items-center gap-4 rounded-xl border border-forest/8 bg-white p-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-forest text-xs font-bold text-gold-light">
                  {i + 1}
                </span>
                <p className="text-sm font-medium text-forest/80">{step}</p>
                {i < arr.length - 1 && <ArrowRight className="ml-auto size-4 shrink-0 text-forest/25" />}
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ---------------------------------------------------- HOW IT WORKS */}
      <section id="how" className="relative bg-forest text-ivory">
        <div className="absolute inset-0 pattern-grid-dark" />
        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            variants={fadeUp}
            className="mx-auto max-w-2xl text-center"
          >
            <Badge className="border-gold/50 bg-gold/15 text-gold-light">The golden path</Badge>
            <h2 className="mt-4 font-display text-4xl font-semibold sm:text-5xl">
              From &ldquo;I need someone to handle this&rdquo; to &ldquo;It&apos;s done.&rdquo;
            </h2>
            <p className="mt-4 text-lg text-ivory/70">
              A workflow engine enforces every step. AI may recommend — it never decides for you.
            </p>
          </motion.div>

          <div className="mt-16 grid gap-10 md:grid-cols-4">
            {STEPS.map((s, i) => (
              <motion.div
                key={s.title}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, margin: '-60px' }}
                variants={fadeUp}
                custom={i}
                className="relative"
              >
                {i < STEPS.length - 1 && (
                  <div className="absolute left-16 top-8 hidden h-px w-[calc(100%-4rem)] bg-gradient-to-r from-gold/50 to-gold/10 md:block" />
                )}
                <div className="relative flex size-16 items-center justify-center rounded-2xl border border-gold/30 bg-gold/10 text-gold-light">
                  <s.icon className="size-7" />
                </div>
                <p className="mt-5 text-[11px] font-bold uppercase tracking-widest text-gold-light/80">
                  Step {i + 1}
                </p>
                <h3 className="mt-2 font-display text-xl font-semibold">{s.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-ivory/65">{s.copy}</p>
              </motion.div>
            ))}
          </div>

          <div className="mt-14 text-center">
            <Button
              size="lg"
              className="h-12 bg-gold px-7 font-semibold text-forest-deep shadow-lg shadow-gold/30 transition-all hover:-translate-y-0.5 hover:bg-gold-light"
              onClick={startRequest}
            >
              Start a Request
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- WHY ASOJU */}
      <section id="why" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          variants={fadeUp}
          className="mx-auto max-w-2xl text-center"
        >
          <Badge className="border-gold/40 bg-gold/10 text-clay">Why ASOJU</Badge>
          <h2 className="mt-4 font-display text-4xl font-semibold text-forest sm:text-5xl">
            Because important things deserve more than &ldquo;I&apos;ll check on it.&rdquo;
          </h2>
        </motion.div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {WHY_ASOJU_PILLARS.map((p, i) => (
            <motion.div
              key={p.title}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: '-60px' }}
              variants={fadeUp}
              custom={i}
              className="rounded-2xl border border-forest/10 bg-white p-6 shadow-sm"
            >
              <div className="flex size-11 items-center justify-center rounded-xl bg-forest/8 text-forest">
                <p.icon className="size-5" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-forest">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-forest/65">{p.copy}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------- TRUST */}
      <section id="trust" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }} variants={fadeUp}>
            <Badge className="border-gold/40 bg-gold/10 text-clay">Trust &amp; evidence</Badge>
            <h2 className="mt-4 font-display text-4xl font-semibold text-forest sm:text-5xl">
              You don&apos;t have to take our word for it.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-forest/65">
              Every claim in every report carries a label that says where it came from and how we know. Evidence
              is captured with server timestamps, reviewed by QC, and can never be silently edited.
            </p>
            <ul className="mt-8 space-y-3">
              {TRUST_LABELS.map((t) => (
                <li key={t.label} className="flex items-start gap-3 rounded-xl border border-forest/8 bg-white p-3.5">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-forest" />
                  <div>
                    <p className="text-sm font-semibold text-forest">{t.label}</p>
                    <p className="text-xs text-forest/55">{t.copy}</p>
                  </div>
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-80px' }}
            variants={fadeUp}
            custom={1}
            className="relative"
          >
            <div className="rounded-3xl border border-forest/10 bg-white p-7 shadow-xl shadow-forest/10">
              <div className="flex items-center justify-between">
                <p className="font-display text-lg font-semibold text-forest">Case confidence</p>
                <Badge className="border-emerald-200 bg-emerald-100 text-emerald-800">Delivered</Badge>
              </div>
              <div className="mt-6 space-y-4">
                {[
                  ['Identity', 'Complete', 100],
                  ['Physical inspection', 'Complete', 100],
                  ['Documents', 'Partial', 55],
                  ['Professional review', 'Pending', 20],
                ].map(([label, state, pct]) => (
                  <div key={label as string}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-forest/75">{label}</span>
                      <span className="text-xs font-semibold text-forest/50">{state}</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-forest/8">
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${pct}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.9, ease: 'easeOut' }}
                        className="h-full rounded-full bg-gradient-to-r from-forest to-gold"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 grid grid-cols-3 gap-3 border-t border-forest/8 pt-5 text-center">
                {[
                  ['3', 'photos captured'],
                  ['1', 'video walkthrough'],
                  ['1', 'QC-approved report'],
                ].map(([n, l]) => (
                  <div key={l}>
                    <p className="font-display text-2xl font-semibold text-forest">{n}</p>
                    <p className="text-[11px] text-forest/50">{l}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute -bottom-5 left-8 right-8 rounded-2xl border border-gold/30 bg-forest px-5 py-3.5 text-center text-xs text-ivory/85 shadow-lg">
              <span className="font-semibold text-gold-light">Non-negotiable:</span> no payment status from
              screenshots, no evidence without a case, no report that hides unresolved issues.
            </div>
          </motion.div>
        </div>
      </section>

      {/* ------------------------------------------------------ PRICING */}
      <section id="pricing" className="bg-sand/60 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            variants={fadeUp}
            className="mx-auto max-w-2xl text-center"
          >
            <Badge className="border-gold/40 bg-gold/10 text-clay">Pricing</Badge>
            <h2 className="mt-4 font-display text-4xl font-semibold text-forest sm:text-5xl">
              Essential or Concierge — your call
            </h2>
            <p className="mt-4 text-lg text-forest/65">
              Transparent, line-item quotes. External costs are never hidden inside service fees.
            </p>
          </motion.div>

          {/* Four cards, matching the live asoju.freebuff.app deployment
              and this backend's now-restored ESSENTIAL plan (see
              dashboard/billing/page.tsx's comment). */}
          <div className="mx-auto mt-14 grid max-w-6xl gap-6 md:grid-cols-2 xl:grid-cols-4">
            <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="rounded-3xl border border-forest/10 bg-white p-8">
              <div className="flex items-center gap-2.5">
                <span className="flex size-10 items-center justify-center rounded-xl bg-forest/8 text-forest">
                  <Map className="size-5" />
                </span>
                <div>
                  <h3 className="font-display text-xl font-semibold text-forest">Pay As You Go</h3>
                  <p className="text-xs text-forest/50">Pay-per-service</p>
                </div>
              </div>
              <p className="mt-4 font-display text-3xl font-semibold text-forest">
                ₦0<span className="text-sm font-normal text-forest/50"> /mo</span>
              </p>
              <ul className="mt-6 space-y-3 text-sm text-forest/70">
                <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" /> AI Concierge intake &amp; case tracking</li>
                <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" /> Verified representative on site</li>
                <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" /> Photo/video evidence + QC report</li>
                <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" /> Region-based quotes, rate locked 48h</li>
              </ul>
              <Button className="mt-8 w-full bg-forest text-ivory hover:bg-forest-deep" onClick={startRequest}>
                Start free
              </Button>
            </motion.div>

            <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} custom={1} className="rounded-3xl border border-forest/10 bg-white p-8">
              <div className="flex items-center gap-2.5">
                <span className="flex size-10 items-center justify-center rounded-xl bg-gold/15 text-clay">
                  <Sparkles className="size-5" />
                </span>
                <div>
                  <h3 className="font-display text-xl font-semibold text-forest">Essential</h3>
                  <p className="text-xs text-forest/50">Subscription + SC voucher</p>
                </div>
              </div>
              <p className="mt-4 font-display text-3xl font-semibold text-forest">
                $49<span className="text-sm font-normal text-forest/50"> /mo</span>
              </p>
              <ul className="mt-6 space-y-3 text-sm text-forest/70">
                <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" /> Everything in Pay As You Go</li>
                <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" /> $30 Special Credit (SC) every month</li>
                <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" /> 5% off out-of-pocket overages</li>
                <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" /> Priority scheduling &amp; dedicated queue</li>
              </ul>
              <Button className="mt-8 w-full bg-clay text-ivory hover:bg-clay-deep" onClick={openBilling}>
                Subscribe to Essential
              </Button>
            </motion.div>

            <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} custom={2} className="relative overflow-hidden rounded-3xl border border-gold/40 bg-white p-8 shadow-xl shadow-gold/10">
              <Badge className="absolute right-6 top-6 border-gold/40 bg-gold/10 text-clay">Best value</Badge>
              <div className="flex items-center gap-2.5">
                <span className="flex size-10 items-center justify-center rounded-xl bg-gold/15 text-clay">
                  <Sparkles className="size-5" />
                </span>
                <div>
                  <h3 className="font-display text-xl font-semibold text-forest">Priority</h3>
                  <p className="text-xs text-forest/50">Subscription + SC voucher</p>
                </div>
              </div>
              <p className="mt-4 font-display text-3xl font-semibold text-forest">
                $99<span className="text-sm font-normal text-forest/50"> /mo</span>
              </p>
              <ul className="mt-6 space-y-3 text-sm text-forest/70">
                <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" /> Everything in Essential</li>
                <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" /> $60 Special Credit (SC) every month</li>
                <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" /> 12% off out-of-pocket overages</li>
                <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest" /> Gold-agent assignment + recurring visits</li>
              </ul>
              <Button className="mt-8 w-full border-gold/40 bg-clay text-ivory hover:bg-clay-deep" onClick={openBilling}>
                Subscribe to Priority
              </Button>
            </motion.div>

            <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} custom={3} className="relative overflow-hidden rounded-3xl bg-forest p-8 text-ivory shadow-2xl shadow-forest/30">
              <div className="absolute inset-0 pattern-grid-dark" />
              <div className="relative">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-gold/20 text-gold-light">
                    <Sparkles className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-display text-xl font-semibold">Premium</h3>
                    <p className="text-xs text-ivory/60">Subscription, relationship-managed</p>
                  </div>
                </div>
                <p className="mt-4 font-display text-3xl font-semibold">
                  $199<span className="text-sm font-normal text-ivory/60"> /mo</span>
                </p>
                <ul className="mt-6 space-y-3 text-sm text-ivory/75">
                  <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-gold-light" /> Everything in Priority</li>
                  <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-gold-light" /> $100 Special Credit (SC) every month</li>
                  <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-gold-light" /> 15% off out-of-pocket overages</li>
                  <li className="flex gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-gold-light" /> Dedicated relationship manager</li>
                </ul>
                <Button variant="outline" className="mt-8 w-full border-gold/40 bg-transparent text-gold-light hover:bg-gold/10 hover:text-gold-light" onClick={openBilling}>
                  Subscribe to Premium
                </Button>
              </div>
            </motion.div>
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-forest/50">
            SC vouchers are single-use per billing cycle — any unused balance is forfeited. Apply your SC at
            checkout on Lagos &amp; South-West cases; remote &quot;Other Location&quot; cases carry full regional
            pricing (Lagos ₦ / South-West / remote by case-manager scoping). The SC voucher and your plan discount
            are mutually exclusive — applying your SC replaces the discount. Quotes lock today&apos;s
            parallel-market rate for 48 hours.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------- DIASPORA */}
      <section className="bg-forest py-24 text-ivory">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <Badge className="border-gold/50 bg-gold/15 text-gold-light">Wherever you are</Badge>
          <h2 className="mt-4 font-display text-4xl font-semibold sm:text-5xl">
            You may live abroad. Your responsibilities don&apos;t.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-ivory/70">
            Your family, property, projects and important decisions are still happening in Nigeria. ASOJU gives
            you a trusted way to stay represented, informed and involved — without having to be physically
            present for everything.
          </p>
          <Button
            size="lg"
            variant="outline"
            className="mt-8 h-12 border-gold/40 bg-transparent px-7 text-gold-light hover:bg-ivory/10"
            onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })}
          >
            See How ASOJU Can Help
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </section>

      {/* ----------------------------------------------------------- CTA */}
      <section className="px-4 pb-24 sm:px-6">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          variants={fadeUp}
          className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-forest px-6 py-16 text-center text-ivory shadow-2xl shadow-forest/30 sm:px-16"
        >
          <div className="absolute inset-0 pattern-grid-dark" />
          <div className="pointer-events-none absolute -top-24 left-1/2 size-96 -translate-x-1/2 rounded-full bg-gold/20 blur-3xl" />
          <div className="relative">
            <h2 className="font-display text-4xl font-semibold sm:text-5xl">Something needs to be handled in Nigeria?</h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-ivory/70">Tell ASOJU what you need.</p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button
                size="lg"
                className="h-12 bg-gold px-7 font-semibold text-forest-deep shadow-lg shadow-gold/30 transition-all hover:-translate-y-0.5 hover:bg-gold-light"
                onClick={startRequest}
              >
                Start with the ASOJU Concierge
                <ArrowRight className="size-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 border-ivory/30 bg-transparent px-7 text-ivory hover:bg-ivory/10"
                onClick={() => go('/login')}
              >
                <PhoneCall className="size-4" />
                Talk to us
              </Button>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ------------------------------------------------------- FOOTER */}
      <footer className="border-t border-forest/10 bg-ivory">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-lg bg-forest text-gold-light font-display text-lg font-bold">
                A
              </span>
              <div>
                <p className="font-display text-lg font-semibold text-forest">ASOJU</p>
                <p className="text-xs text-forest/50">Your trusted rep back home.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-forest/60">
              <a href="#services" className="hover:text-forest">Services</a>
              <a href="#how" className="hover:text-forest">How it works</a>
              <a href="#why" className="hover:text-forest">Why ASOJU</a>
              <a href="#trust" className="hover:text-forest">Trust &amp; evidence</a>
              <a href="#pricing" className="hover:text-forest">Pricing</a>
            </div>
            <div className="flex items-center gap-2 text-xs text-forest/45">
              <Building2 className="size-4" />
              Lagos · Abuja · Lagos &amp; environs
            </div>
          </div>
          <p className="mt-8 text-center text-xs text-forest/40">
            ASOJU is a technology-enabled coordination &amp; execution platform, not a law firm, surveying firm or
            estate agency. All professional opinions come from appropriately licensed professionals.
          </p>
        </div>
      </footer>
    </div>
  );
}
