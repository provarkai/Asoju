'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getSessionUser, SessionUser } from '@/lib/api';
import { ADMIN_ROLES } from '@/lib/roles';

const BASE_TABS = [
  { href: '/ops', label: 'Queue' },
  { href: '/ops/agents', label: 'Agents' },
  { href: '/ops/providers', label: 'Providers' },
];

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    setUser(getSessionUser());
  }, []);

  const tabs = [...BASE_TABS];
  if (user?.role === 'RELATIONSHIP_MANAGER' || (user && ADMIN_ROLES.includes(user.role))) {
    tabs.push({ href: '/ops/portfolio', label: 'Portfolio' });
  }
  if (user && ADMIN_ROLES.includes(user.role)) {
    tabs.push({ href: '/ops/concierge', label: 'Concierge' });
  }
  if (user && ADMIN_ROLES.includes(user.role)) {
    tabs.push({ href: '/ops/accounts', label: 'Accounts' });
  }
  if (user && ADMIN_ROLES.includes(user.role)) {
    tabs.push({ href: '/ops/partners', label: 'Partners' });
  }
  if (user && (ADMIN_ROLES.includes(user.role) || user.role === 'COMPLIANCE_RISK')) {
    tabs.push({ href: '/ops/risk', label: 'Risk' });
  }
  if (user && (ADMIN_ROLES.includes(user.role) || user.role === 'FINANCE')) {
    tabs.push({ href: '/ops/analytics', label: 'Analytics' });
  }
  if (user && ADMIN_ROLES.includes(user.role)) {
    tabs.push({ href: '/ops/audit', label: 'Audit Log' });
  }

  return (
    <div>
      <nav className="actions-row" style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--asoju-border)', paddingBottom: '0.75rem' }}>
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`btn ${pathname === tab.href ? '' : 'btn--ghost'}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
