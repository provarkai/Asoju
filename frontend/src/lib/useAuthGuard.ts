'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSessionUser, SessionUser } from './api';
import { landingPathForRole } from './roles';

/** Client-side route guard for the P0 customer portal (see api.ts note on auth strategy).
 *
 * Unlike every other portal's guard (useOpsGuard, useFieldGuard, ...) this
 * one used to only check "is anyone logged in", never "is this customer's
 * portal for this role" — a real user hit exactly the resulting gap: a
 * FIELD_AGENT session (e.g. left over from testing the field portal) could
 * still browse every /dashboard/* page freely, and only discovered the
 * mismatch when an action hit the backend's `@Roles(Role.CUSTOMER)` guard
 * and surfaced a raw, unhelpful "Forbidden resource" error deep in a form.
 * Now redirects any signed-in non-CUSTOMER straight to their own portal,
 * same as every other guard already does. */
export function useAuthGuard(): { user: SessionUser | null; ready: boolean } {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sessionUser = getSessionUser();
    if (!sessionUser) {
      // Carries the page the visitor was trying to reach back through
      // login — /login already reads this (see afterSignIn's own
      // same-origin check) and falls back to the role landing page when
      // it's absent, so a direct deep link to a protected page (e.g. a
      // shared case URL) survives the sign-in round trip instead of
      // dropping the visitor on the dashboard home.
      const returnTo = window.location.pathname + window.location.search;
      router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    if (sessionUser.role !== 'CUSTOMER') {
      router.replace(landingPathForRole(sessionUser.role));
      return;
    }
    setUser(sessionUser);
    setReady(true);
  }, [router]);

  return { user, ready };
}
