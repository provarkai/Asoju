'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { clearSession, getSessionUser, SessionUser } from '@/lib/api';
import { FIELD_ROLES, PARTNER_ROLES, BENEFICIARY_ROLES, landingPathForRole, OPS_ROLES } from '@/lib/roles';
import { SERVICE_FAMILIES } from '@/lib/services';
import { NotificationBell } from './NotificationBell';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

// GlobalHeader (Sprint 1 — docs/frontend-handoff-v1.0/00_Master_Developer_
// Handoff §8, 05_Implementation Sprint 1: "Build GlobalHeader and
// six-service menu... Build responsive mobile navigation."
//
// Desktop: a <details>/<summary> disclosure for the six-service menu —
// keyboard-operable and screen-reader-exposed natively, no extra JS.
// Mobile: a hamburger button opens the shared Modal primitive in its
// drawer variant, reusing its focus-trap/Escape/return-focus behavior
// rather than building a second overlay implementation.

function navLabel(role: string): string {
  if (OPS_ROLES.includes(role)) return 'Ops Console';
  if (FIELD_ROLES.includes(role)) return 'My jobs';
  if (PARTNER_ROLES.includes(role)) return 'Partner dashboard';
  if (BENEFICIARY_ROLES.includes(role)) return 'Cases I can see';
  return 'My cases';
}

function ServiceLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      {SERVICE_FAMILIES.map((service) => (
        <Link key={service.slug} href={`/${service.slug}`} onClick={onNavigate}>
          {service.name}
        </Link>
      ))}
    </>
  );
}

export function SiteHeader() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

        <nav className="nav nav--desktop" aria-label="Primary">
          <details className="services-menu">
            <summary>Services</summary>
            <div className="services-menu__panel" role="menu">
              {SERVICE_FAMILIES.map((service) => (
                <Link key={service.slug} href={`/${service.slug}`} role="menuitem">
                  <strong>{service.name}</strong>
                  <span className="muted">{service.tagline}</span>
                </Link>
              ))}
            </div>
          </details>
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

        <button
          type="button"
          className="nav-trigger"
          aria-expanded={mobileNavOpen}
          aria-controls="mobile-nav-drawer"
          onClick={() => setMobileNavOpen(true)}
        >
          <span aria-hidden="true">☰</span>
          <span className="sr-only">Menu</span>
        </button>
      </div>

      <Modal open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} title="Menu" variant="drawer">
        <nav className="mobile-nav" aria-label="Primary" id="mobile-nav-drawer">
          <p className="mobile-nav__heading">Services</p>
          <ServiceLinks onNavigate={() => setMobileNavOpen(false)} />
          <hr className="mobile-nav__divider" />
          {user ? (
            <>
              <Link href={landingPathForRole(user.role)} onClick={() => setMobileNavOpen(false)}>
                {navLabel(user.role)}
              </Link>
              {user.role === 'CUSTOMER' && (
                <Link href="/profile" onClick={() => setMobileNavOpen(false)}>
                  My Nigeria
                </Link>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  clearSession();
                  window.location.href = '/';
                }}
              >
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Link href="/login" onClick={() => setMobileNavOpen(false)}>
                Sign in
              </Link>
              <Link href="/register" className="btn" onClick={() => setMobileNavOpen(false)}>
                Get started
              </Link>
            </>
          )}
        </nav>
      </Modal>
    </header>
  );
}
