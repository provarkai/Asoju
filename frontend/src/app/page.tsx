'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSessionUser } from '@/lib/api';
import { ConciergeChat } from '@/components/ConciergeChat';

// Section 5.1 — Customer Portal home screen: "What would you like us to
// handle for you in Nigeria?" This is the natural-language entry point
// that routes through the AI Concierge (Section 5.2 / 7.2).
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
            Tell us in your own words — property, a construction project, an asset you need checked on.
            We&apos;ll ask a few quick questions and take it from there.
          </p>
        </div>
        <ConciergeChat />
      </div>
    );
  }

  return (
    <div className="hero">
      <h1>Your trusted presence back home.</h1>
      <p>
        ASOJU helps Nigerians abroad verify, manage and execute important tasks in Nigeria — property
        inspections, construction supervision, and asset checks — without being physically present.
      </p>
      <div className="actions-row" style={{ marginTop: '1.5rem' }}>
        <Link href="/register" className="btn">
          Get started
        </Link>
        <Link href="/login" className="btn btn--secondary">
          Sign in
        </Link>
      </div>

      <div className="card" style={{ marginTop: '2.5rem' }}>
        <h2 style={{ marginTop: 0 }}>What we handle today</h2>
        <ul>
          <li>
            <strong>Property Inspection &amp; Verification</strong> — confirm a location, inspect
            condition, photograph and video the site, flag discrepancies.
          </li>
          <li>
            <strong>Construction / Project Supervision</strong> — scheduled site visits with
            before/after evidence for a project you can&apos;t be there to watch.
          </li>
          <li>
            <strong>Asset / Project Inspection</strong> — house, farm, business premises, equipment
            or vehicle — inspected, evidenced, and reported on.
          </li>
        </ul>
        <p className="muted">
          Not a legal title certification, survey, valuation, or structural assessment — those go
          through an appropriately qualified professional we coordinate for you.
        </p>
      </div>
    </div>
  );
}
