'use client';

import { useEffect, useState } from 'react';
import { getSessionUser, SessionUser } from './api';

/** Non-redirecting session read — for pages like Landing that need to
 * know whether someone's signed in (to say "Sign in" vs "Open portal")
 * without forcing a redirect the way useAuthGuard does for the portal
 * pages proper. */
export function useAuth(): { isLoading: boolean; isAuthenticated: boolean; user: SessionUser | null } {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setUser(getSessionUser());
    setIsLoading(false);
  }, []);

  return { isLoading, isAuthenticated: !!user, user };
}
