'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { clearSession, getSessionUser, SessionUser } from '@/lib/api';
import { FIELD_ROLES, PARTNER_ROLES, BENEFICIARY_ROLES, landingPathForRole, OPS_ROLES } from '@/lib/roles';
import { NotificationBell } from './NotificationBell';

function navLabel(role: string): string {
  if (OPS_ROLES.includes(role)) return 'Ops Console';
  if (FIELD_ROLES.includes(role)) return 'My jobs';
  if (PARTNER_ROLES.includes(role)) return 'Partner dashboard';
  if (BENEFICIARY_ROLES.includes(role)) return 'Cases I can see';
  return 'My cases';
}

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
          <small>Your trusted rep back home</small>
        </Link>
        <nav className="nav">
          {user ? (
            <>
              <Link href={landingPathForRole(user.role)}>{navLabel(user.role)}</Link>
              {user.role === 'CUSTOMER' && <Link href="/profile">My Nigeria</Link>}
              <NotificationBell />
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
