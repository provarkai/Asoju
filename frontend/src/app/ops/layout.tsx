'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/ops', label: 'Queue' },
  { href: '/ops/agents', label: 'Agents' },
  { href: '/ops/providers', label: 'Providers' },
];

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div>
      <nav className="actions-row" style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--asoju-border)', paddingBottom: '0.75rem' }}>
        {TABS.map((tab) => (
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
