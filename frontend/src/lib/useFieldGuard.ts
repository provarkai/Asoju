'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSessionUser, SessionUser } from './api';
import { FIELD_ROLES, landingPathForRole } from './roles';

/** Route guard for the Field Agent App (Section 5.4) — agents and providers only. */
export function useFieldGuard(): { user: SessionUser | null; ready: boolean } {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sessionUser = getSessionUser();
    if (!sessionUser) {
      router.replace('/login');
      return;
    }
    if (!FIELD_ROLES.includes(sessionUser.role)) {
      router.replace(landingPathForRole(sessionUser.role));
      return;
    }
    setUser(sessionUser);
    setReady(true);
  }, [router]);

  return { user, ready };
}
