'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSessionUser, SessionUser } from './api';
import { landingPathForRole, OPS_ROLES } from './roles';

/** Route guard for the Ops Console (Section 5.3) — internal staff roles only. */
export function useOpsGuard(): { user: SessionUser | null; ready: boolean } {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sessionUser = getSessionUser();
    if (!sessionUser) {
      router.replace('/login');
      return;
    }
    if (!OPS_ROLES.includes(sessionUser.role)) {
      router.replace(landingPathForRole(sessionUser.role));
      return;
    }
    setUser(sessionUser);
    setReady(true);
  }, [router]);

  return { user, ready };
}
