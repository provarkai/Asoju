'use client';

import { useRouter } from 'next/navigation';
import { Camera, ShieldCheck, Sparkles } from 'lucide-react';

/** Shared left-hand brand panel for /login and /register — hidden below
 * lg, matching the prototype's Auth.tsx (a mobile logo replaces it, see
 * each page's own small-screen header). */
export function AuthBrandPanel() {
  const router = useRouter();
  return (
    <div className="relative hidden w-1/2 overflow-hidden bg-forest text-ivory lg:block">
      <div className="absolute inset-0 pattern-grid-dark" />
      <div className="pointer-events-none absolute -top-32 right-[-10%] size-[480px] rounded-full bg-gold/20 blur-3xl" />
      <div className="relative flex h-full flex-col justify-between p-12">
        <button onClick={() => router.push('/')} className="flex items-center gap-2.5 self-start" aria-label="ASOJU home">
          <span className="flex size-10 items-center justify-center rounded-lg bg-gold/20 font-display text-xl font-bold text-gold-light">
            A
          </span>
          <span className="font-display text-2xl font-semibold">ASOJU</span>
        </button>

        <div className="max-w-md">
          <h1 className="font-display text-4xl font-semibold leading-tight">
            Your trusted <span className="text-gradient-gold">presence</span> back home.
          </h1>
          <p className="mt-4 text-lg text-ivory/70">
            Sign in to track inspections, review evidence, approve reports and stay in control of everything ASOJU
            handles for you in Nigeria.
          </p>
          <ul className="mt-8 space-y-4 text-sm text-ivory/75">
            <li className="flex items-center gap-3">
              <ShieldCheck className="size-5 shrink-0 text-gold-light" />
              Case-scoped access — only you see your cases
            </li>
            <li className="flex items-center gap-3">
              <Camera className="size-5 shrink-0 text-gold-light" />
              Dated photo &amp; video evidence on every task
            </li>
            <li className="flex items-center gap-3">
              <Sparkles className="size-5 shrink-0 text-gold-light" />
              AI Concierge that hands off to humans, not away from them
            </li>
          </ul>
        </div>

        <p className="text-xs text-ivory/40">Serving Nigerians abroad — UK · USA · Canada → Lagos &amp; environs</p>
      </div>
    </div>
  );
}

export function AuthMobileLogo() {
  const router = useRouter();
  return (
    <button onClick={() => router.push('/')} className="mb-6 flex items-center gap-2.5 lg:hidden">
      <span className="flex size-9 items-center justify-center rounded-lg bg-forest font-display text-lg font-bold text-gold-light">
        A
      </span>
      <span className="font-display text-xl font-semibold text-forest">ASOJU</span>
    </button>
  );
}
