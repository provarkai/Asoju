'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSessionUser, SessionUser } from './api';
import { BENEFICIARY_ROLES, landingPathForRole } from './roles';

/** Route guard for the Beneficiary portal — "Who is a Beneficiary" (portal
 * access): the person a Customer names on a case, not the account holder. */
export function useBeneficiaryGuard(): { user: SessionUser | null; ready: boolean } {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sessionUser = getSessionUser();
    if (!sessionUser) {
      router.replace('/login');
      return;
    }
    if (!BENEFICIARY_ROLES.includes(sessionUser.role)) {
      router.replace(landingPathForRole(sessionUser.role));
      return;
    }
    setUser(sessionUser);
    setReady(true);
  }, [router]);

  return { user, ready };
}
