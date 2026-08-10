'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSessionUser, SessionUser } from './api';
import { PARTNER_ROLES, landingPathForRole } from './roles';

/** Route guard for the Partner portal (Section 12 P2) — partner contacts only. */
export function usePartnerGuard(): { user: SessionUser | null; ready: boolean } {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sessionUser = getSessionUser();
    if (!sessionUser) {
      router.replace('/login');
      return;
    }
    if (!PARTNER_ROLES.includes(sessionUser.role)) {
      router.replace(landingPathForRole(sessionUser.role));
      return;
    }
    setUser(sessionUser);
    setReady(true);
  }, [router]);

  return { user, ready };
}
