'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { clearSession, getSessionUser, SessionUser } from '@/lib/api';
import { landingPathForRole, OPS_ROLES } from '@/lib/roles';

export function SiteHeader() {
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    setUser(getSessionUser());
  }, []);

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link href="/" className="brand">
          ASOJU
          <small>Your trusted presence back home</small>
        </Link>
        <nav className="nav">
          {user ? (
            <>
              <Link href={landingPathForRole(user.role)}>
                {OPS_ROLES.includes(user.role) ? 'Ops Console' : 'My cases'}
              </Link>
              <button
                className="btn btn--ghost"
                onClick={() => {
                  clearSession();
                  window.location.href = '/';
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login">Sign in</Link>
              <Link href="/register" className="btn">
                Get started
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
