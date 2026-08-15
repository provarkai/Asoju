'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSessionUser, SessionUser } from './api';

/** Client-side route guard for the P0 customer portal (see api.ts note on auth strategy). */
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
    setUser(sessionUser);
    setReady(true);
  }, [router]);

  return { user, ready };
}
