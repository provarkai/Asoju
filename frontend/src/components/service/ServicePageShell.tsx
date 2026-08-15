'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2, ClipboardCheck, MessageCircle, Camera, FileText, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import AiConciergeDemo from '@/components/landing/AiConciergeDemo';
import { useAuth } from '@/lib/useAuth';
import { naira } from '@/lib/format';
import type { ServiceFamily } from '@/lib/services';
import { SERVICE_FAMILIES } from '@/lib/services';

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

// Same universal golden-path steps used on the homepage — Sprint 5 asks
// for "shared How It Works ... sections", not six independent retellings
// of the same process. Keeping this one copy here (rather than importing
// from app/page.tsx, which isn't an exportable module) is the accepted
// duplication until that homepage copy is itself extracted to a shared
// location — the two must be kept in sync if either changes.
const STEPS = [
  {
    icon: MessageCircle,
    title: 'Tell us what to handle',
    copy: 'Describe what you need done in Nigeria in plain language — the AI Concierge understands and captures the essentials in minutes, not days.',
  },
  {
    icon: ClipboardCheck,
    title: 'We verify, quote & schedule',
    copy: 'A human team confirms scope, sends a transparent line-item quote, and schedules a vetted representative once you accept.',
  },
  {
    icon: Camera,
    title: 'A trusted presence executes',
    copy: 'Your representative physically goes and does the work, capturing dated photo, video and note evidence throughout.',
  },
  {
    icon: FileText,
    title: 'Evidence → QC → your approval',
    copy: 'Every evidence package passes quality control, becomes a plain-language report, and lands in your portal. You approve — you stay in control.',
  },
];

// Same evidence-labelling discipline as the homepage's Trust section —
// real, system-level behaviour (how every claim is labelled), not a
// per-service claim, so it's safe to repeat verbatim across all six pages.
const TRUST_LABELS = [
  { label: 'ASOJU Verified', copy: 'Identity & process verified by ASOJU' },
  { label: 'Professionally Reviewed', copy: 'Reviewed by a qualified professional' },
  { label: 'Customer Provided', copy: 'Information came from you' },
  { label: 'Not Independently Verified', copy: 'No independent confirmation yet' },
];

/** Sprint 5 "shared service-page shell" — every one of the six locked
 * service routes (Sprint 6) renders through this, configured entirely by
 * lib/services.ts's per-family content. No page-specific markup beyond
 * that config, per the handoff's "create reusable service content
 * configuration rather than duplicated page code" instruction. */
export function ServicePageShell({ service }: { service: ServiceFamily }) {
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  const go = (path: string) => router.push(path);
  const startRequest = () => go(isAuthenticated ? '/dashboard/new' : '/register?returnTo=%2Fdashboard%2Fnew');

  const otherServices = SERVICE_FAMILIES.filter((s) => s.slug !== service.slug);

  return (
    <div className="min-h-screen bg-ivory">
      {/* -------------------------------------------------------- HEADER */}
      <header className="sticky top-0 z-40 border-b border-forest/8 bg-ivory/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-forest font-display text-base font-bold text-gold-light">
              A
            </span>
            <span className="font-display text-lg font-semibold text-forest">ASOJU</span>
          </Link>
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

      {/* ---------------------------------------------------------- HERO */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute -top-40 right-[-10%] size-[540px] rounded-full opacity-40 blur-3xl"
          style={{ background: 'radial-gradient(circle, #e3b94e55, transparent 65%)' }}
        />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-2 lg:items-center lg:pt-20">
          <motion.div initial="hidden" animate="show" variants={fadeUp}>
            <Badge className="mb-5 border-gold/40 bg-gold/10 px-3 py-1 text-xs font-semibold text-clay">{service.name}</Badge>
            <h1 className="font-display text-4xl font-semibold leading-[1.08] tracking-tight text-forest sm:text-5xl">
              {service.tagline}
            </h1>
            {service.fromNgn !== undefined && (
              <p className="mt-5 text-lg leading-relaxed text-forest/70">
                Starting from <span className="font-semibold text-forest">{naira(service.fromNgn)}</span> — a
                transparent quote confirms the exact price before anything is scheduled.
              </p>
            )}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" className="bg-forest text-ivory hover:bg-forest-deep" onClick={startRequest}>
                Start a request
                <ArrowRight className="size-4" />
              </Button>
              <Button size="lg" variant="ghost" className="text-forest hover:bg-forest/5" onClick={() => go('/')}>
                Back to homepage
              </Button>
            </div>
          </motion.div>

          <motion.div initial="hidden" animate="show" variants={fadeUp} custom={1}>
            <AiConciergeDemo
              isAuthenticated={isAuthenticated}
              onNavigate={go}
              greeting={`Hi 👋 — I'm the ASOJU AI Concierge. Tell me what you need for ${service.name.replace('ASOJU ', '')} and I'll capture the essentials.`}
              quickPrompts={service.quickPrompts}
            />
          </motion.div>
        </div>
      </section>

      {/* ------------------------------------------------------ USE CASES */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="max-w-2xl">
          <Badge className="border-gold/40 bg-gold/10 text-clay">What we handle</Badge>
          <h2 className="mt-4 font-display text-3xl font-semibold text-forest sm:text-4xl">Common {service.name} requests</h2>
        </motion.div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {service.useCases.map((useCase, i) => (
            <motion.div
              key={useCase}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: '-60px' }}
              variants={fadeUp}
              custom={i}
              className="flex items-start gap-3 rounded-2xl border border-forest/10 bg-white p-5"
            >
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-forest" />
              <p className="text-sm leading-relaxed text-forest/75">{useCase}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------- HOW IT WORKS */}
      <section className="relative bg-forest text-ivory">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="max-w-2xl">
            <Badge className="border-gold/30 bg-gold/15 text-gold-light">How it works</Badge>
            <h2 className="mt-4 font-display text-3xl font-semibold sm:text-4xl">From request to result</h2>
          </motion.div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <motion.div
                key={step.title}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, margin: '-60px' }}
                variants={fadeUp}
                custom={i}
                className="rounded-2xl border border-ivory/10 bg-ivory/5 p-5"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-gold/20 text-gold-light">
                  <step.icon className="size-5" />
                </span>
                <p className="mt-4 font-display text-base font-semibold">{step.title}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-ivory/65">{step.copy}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- OUTCOME */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          variants={fadeUp}
          className="rounded-3xl border border-forest/10 bg-white p-8 shadow-lg shadow-forest/5 sm:p-10"
        >
          <Badge className="border-gold/40 bg-gold/10 text-clay">What you get</Badge>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-forest/75">{service.outcome}</p>
        </motion.div>
      </section>

      {/* ----------------------------------------------------------- TRUST */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="max-w-2xl">
          <Badge className="border-gold/40 bg-gold/10 text-clay">Trust &amp; evidence</Badge>
          <h2 className="mt-4 font-display text-3xl font-semibold text-forest sm:text-4xl">We never say just &quot;verified&quot;</h2>
          <p className="mt-4 text-sm leading-relaxed text-forest/65">
            Every claim in your report carries a label that says where it came from and how we know.
          </p>
        </motion.div>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {TRUST_LABELS.map((t) => (
            <div key={t.label} className="flex items-start gap-3 rounded-xl border border-forest/8 bg-white p-3.5">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-forest" />
              <div>
                <p className="text-sm font-semibold text-forest">{t.label}</p>
                <p className="text-xs text-forest/55">{t.copy}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ FAQ */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="max-w-2xl">
          <Badge className="border-gold/40 bg-gold/10 text-clay">Questions</Badge>
          <h2 className="mt-4 font-display text-3xl font-semibold text-forest sm:text-4xl">Frequently asked</h2>
        </motion.div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {service.faqs.map((faq) => (
            <div key={faq.q} className="rounded-2xl border border-forest/10 bg-white p-5">
              <p className="font-display text-base font-semibold text-forest">{faq.q}</p>
              <p className="mt-2 text-sm leading-relaxed text-forest/65">{faq.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------- CTA */}
      <section className="px-4 pb-20 sm:px-6">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          variants={fadeUp}
          className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-forest px-6 py-14 text-center text-ivory shadow-2xl shadow-forest/30 sm:px-16"
        >
          <h2 className="font-display text-3xl font-semibold sm:text-4xl">Tell the Concierge what you need</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-ivory/70">
            No commitment, no card required — a real conversation, captured in minutes.
          </p>
          <Button size="lg" className="mt-7 bg-gold text-forest-deep hover:bg-gold-light" onClick={startRequest}>
            Start a request
            <ArrowRight className="size-4" />
          </Button>
        </motion.div>
      </section>

      {/* --------------------------------------------------------- FOOTER */}
      <footer className="border-t border-forest/8 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-display text-lg font-semibold text-forest">ASOJU</p>
              <p className="mt-1 text-xs text-forest/50">Your trusted presence back home.</p>
            </div>
            <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-forest/65" aria-label="Other services">
              {otherServices.map((s) => (
                <Link key={s.slug} href={`/${s.slug}`} className="hover:text-forest">
                  {s.name}
                </Link>
              ))}
            </nav>
          </div>
          <p className="mt-8 max-w-2xl text-xs leading-relaxed text-forest/45">
            ASOJU is a technology-enabled coordination &amp; execution platform, not a law firm, surveying firm or
            estate agency. All professional opinions come from appropriately licensed professionals.
          </p>
        </div>
      </footer>
    </div>
  );
}
