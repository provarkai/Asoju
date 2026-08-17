'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getSessionUser, SessionUser } from '@/lib/api';

// #54 — the field portal had no persistent shell at all (every page stood
// alone with its own header), unlike the ops console's layout.tsx. Adding
// one now that there's more than one destination (jobs, earnings, safety)
// worth navigating between without going back through a job first.
const TABS = [
  { href: '/field', label: 'Jobs' },
  { href: '/field/earnings', label: 'Earnings' },
  { href: '/field/profile', label: 'Profile & safety' },
];

export default function FieldLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    setUser(getSessionUser());
  }, []);

  const tabs = user?.role === 'PROVIDER' ? TABS.filter((t) => t.href !== '/field/earnings') : TABS;

  return (
    <div>
      <nav
        className="actions-row"
        style={{
          marginBottom: '1.5rem',
          borderBottom: '1px solid var(--asoju-border)',
          paddingBottom: '0.75rem',
          justifyContent: 'space-between',
        }}
      >
        <div className="actions-row">
          {tabs.map((tab) => (
            <Link key={tab.href} href={tab.href} className={`btn ${pathname === tab.href ? '' : 'btn--ghost'}`}>
              {tab.label}
            </Link>
          ))}
        </div>
        {user?.role === 'FIELD_AGENT' && (
          <Link
            href="/field/profile#sos"
            className="btn"
            style={{ background: 'var(--asoju-danger)', borderColor: 'var(--asoju-danger)' }}
          >
            🆘 SOS
          </Link>
        )}
      </nav>
      {children}
    </div>
  );
}
