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
      router.replace('/login');
      return;
    }
    setUser(sessionUser);
    setReady(true);
  }, [router]);

  return { user, ready };
}
