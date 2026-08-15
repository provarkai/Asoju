'use client';

import { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  CreditCard,
  FilePlus2,
  LayoutDashboard,
  LogOut,
  Menu,
  UserRound,
  UsersRound,
  Vault,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiFetch, clearSession } from '@/lib/api';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { Button } from '@/components/ui/button';
import { timeAgo } from '@/lib/statusMeta';

// The customer portal's own shell (asoju-app-main's Portal.tsx) —
// deliberately NOT SiteHeader/.container. Once a customer is inside
// /dashboard/* or /profile, this sidebar is the primary nav; SiteHeader
// stays exactly as-is for every other role (ops/field/partner/
// beneficiary), whose routes are untouched, still under (portal).
const NAV = [
  { key: 'home', label: 'My cases', path: '/dashboard', icon: LayoutDashboard },
  { key: 'new', label: 'New request', path: '/dashboard/new', icon: FilePlus2 },
  { key: 'billing', label: 'Billing & SC', path: '/dashboard/billing', icon: CreditCard },
  { key: 'vault', label: 'My Nigeria Vault', path: '/dashboard/vault', icon: Vault },
  { key: 'profile', label: 'Profile', path: '/profile', icon: UserRound },
  { key: 'team', label: 'Team', path: '/dashboard/team', icon: UsersRound },
];

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const { ready } = useAuthGuard();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const caseId = typeof params?.id === 'string' ? params.id : undefined;
  const teamCaseId = typeof params?.caseId === 'string' ? params.caseId : undefined;

  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    if (!ready) return;
    apiFetch<NotificationItem[]>('/notifications')
      .then(setNotifications)
      .catch(() => {});
  }, [ready]);

  if (!ready) return null;

  const unread = notifications.filter((n) => !n.readAt).length;

  const activeKey = teamCaseId
    ? 'team'
    : caseId
      ? 'case'
      : pathname === '/dashboard/new'
        ? 'new'
        : pathname === '/dashboard/billing'
          ? 'billing'
          : pathname === '/dashboard/vault'
            ? 'vault'
            : pathname === '/profile'
              ? 'profile'
              : pathname?.startsWith('/dashboard/team')
                ? 'team'
                : 'home';

  const handleSignOut = () => {
    clearSession();
    router.push('/');
  };

  const openNotifications = () => {
    setNotifOpen(true);
    if (unread > 0) {
      apiFetch('/notifications/read-all', { method: 'POST' })
        .then(() => setNotifications((ns) => ns.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }))))
        .catch(() => {});
    }
  };

  return (
    <div className="aam-page flex min-h-screen bg-ivory">
      {/* ------------------------------- Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-forest text-ivory lg:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-ivory/10 px-5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-gold/20 font-display text-lg font-bold text-gold-light">
            A
          </span>
          <div>
            <p className="font-display text-lg font-semibold leading-none">ASOJU</p>
            <p className="mt-0.5 text-[10px] text-ivory/50">Customer portal</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-4">
          {NAV.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                router.push(item.path);
                setMenuOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all',
                activeKey === item.key ? 'bg-gold/15 text-gold-light shadow-inner' : 'text-ivory/65 hover:bg-ivory/8 hover:text-ivory',
              )}
            >
              <item.icon className="size-4.5" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="space-y-1 border-t border-ivory/10 p-4">
          <button
            onClick={openNotifications}
            className="relative flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-ivory/65 transition-all hover:bg-ivory/8 hover:text-ivory"
          >
            <Bell className="size-4.5" />
            Notifications
            {unread > 0 && (
              <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-gold text-[10px] font-bold text-forest-deep">
                {unread}
              </span>
            )}
          </button>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-ivory/65 transition-all hover:bg-ivory/8 hover:text-ivory"
          >
            <LogOut className="size-4.5" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ------------------------------- Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-forest/10 bg-ivory/90 px-4 backdrop-blur lg:hidden">
        <button onClick={() => router.push('/dashboard')} className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-forest font-display text-base font-bold text-gold-light">
            A
          </span>
          <span className="font-display text-lg font-semibold text-forest">ASOJU</span>
        </button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={openNotifications} className="relative">
            <Bell className="size-5 text-forest" />
            {unread > 0 && (
              <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-gold text-[9px] font-bold text-forest-deep">
                {unread}
              </span>
            )}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
            {menuOpen ? <X className="size-5 text-forest" /> : <Menu className="size-5 text-forest" />}
          </Button>
        </div>
      </div>

      {menuOpen && (
        <div className="fixed inset-x-0 top-14 z-30 border-b border-forest/10 bg-ivory p-3 shadow-lg lg:hidden">
          <div className="grid gap-1">
            {NAV.map((item) => (
              <button
                key={item.key}
                onClick={() => {
                  router.push(item.path);
                  setMenuOpen(false);
                }}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium',
                  activeKey === item.key ? 'bg-forest text-gold-light' : 'text-forest hover:bg-forest/5',
                )}
              >
                <item.icon className="size-4.5" />
                {item.label}
              </button>
            ))}
            <button onClick={handleSignOut} className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-forest hover:bg-forest/5">
              <LogOut className="size-4.5" />
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------- Notifications panel */}
      {notifOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setNotifOpen(false)}>
          <div className="flex h-full w-full max-w-80 flex-col border-l border-forest/10 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-forest/10 px-5 py-4">
              <p className="font-display text-lg font-semibold text-forest">Notifications</p>
              <Button variant="ghost" size="icon" onClick={() => setNotifOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {notifications.length === 0 && <p className="py-10 text-center text-sm text-forest/50">You&apos;re all caught up.</p>}
              {notifications.map((n) => (
                <div key={n.id} className={cn('block w-full rounded-xl border p-3.5 text-left', n.readAt ? 'border-forest/8 bg-white' : 'border-gold/40 bg-gold/5')}>
                  <p className="text-sm font-semibold text-forest">{n.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-forest/60">{n.body}</p>
                  <p className="mt-1.5 text-[10px] text-forest/40">{timeAgo(n.createdAt)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------- Main */}
      <main className="flex-1 px-4 pb-16 pt-[4.5rem] sm:px-6 lg:px-10 lg:pt-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
