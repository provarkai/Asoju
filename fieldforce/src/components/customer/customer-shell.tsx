'use client';

import React, { useEffect, useState, useCallback, createContext, useContext } from 'react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Home,
  FileText,
  Briefcase,
  CreditCard,
  User,
  Bell,
  Menu,
  LogOut,
  ChevronRight,
  X,
  MessageSquare,
} from 'lucide-react';
import { setAuthToken, clearAuthToken, authFetch } from '@/lib/auth-fetch';
import { ChatProvider } from '@/components/messaging/chat-provider';

// ─── Types ──────────────────────────────────────────────────────────────

export type CustomerView = 'home' | 'requests' | 'new-request' | 'cases' | 'case-detail' | 'billing' | 'messages' | 'profile';

interface CustomerContextValue {
  activeView: CustomerView;
  setActiveView: (view: CustomerView) => void;
  selectedCaseId: string | null;
  setSelectedCaseId: (id: string | null) => void;
  profile: CustomerProfile | null;
  setProfile: (p: CustomerProfile | null) => void;
  notifications: NotificationItem[];
  setNotifications: (n: NotificationItem[]) => void;
  refreshNotifications: () => void;
  isLoggedIn: boolean;
  setIsLoggedIn: (v: boolean) => void;
  memberName: string;
}

export interface CustomerProfile {
  member: {
    id: string;
    email: string;
    displayName: string;
    role: string;
    phone: string | null;
    avatarUrl: string | null;
    isActive: boolean;
    lastLoginAt: string | null;
    createdAt: string;
    customer: {
      id: string;
      name: string;
      email: string;
      phone: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      country: string | null;
      logoUrl: string | null;
      type: string;
      status: string;
      primaryContact: string | null;
      createdAt: string;
    };
  };
  stats: {
    totalRequests: number;
    totalCases: number;
    totalPayments: number;
  };
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  type: string;
  read: boolean;
  createdAt: string;
}

// ─── Context ────────────────────────────────────────────────────────────

const CustomerContext = createContext<CustomerContextValue>({
  activeView: 'home',
  setActiveView: () => {},
  selectedCaseId: null,
  setSelectedCaseId: () => {},
  profile: null,
  setProfile: () => {},
  notifications: [],
  setNotifications: () => {},
  refreshNotifications: () => {},
  isLoggedIn: false,
  setIsLoggedIn: () => {},
  memberName: '',
});

export const useCustomerContext = () => useContext(CustomerContext);

// ─── Status Badge Helper ────────────────────────────────────────────────

export function getStatusBadge(status: string): { label: string; className: string } {
  const map: Record<string, { label: string; className: string }> = {
    OPEN: { label: 'New', className: 'bg-slate-100 text-slate-700 border-slate-200' },
    QUOTED: { label: 'Awaiting Your Review', className: 'bg-amber-100 text-amber-800 border-amber-200' },
    PAYMENT_PENDING: { label: 'Payment Required', className: 'bg-orange-100 text-orange-800 border-orange-200' },
    ACCEPTED: { label: 'Confirmed', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    IN_PROGRESS: { label: 'In Progress', className: 'bg-sky-100 text-sky-800 border-sky-200' },
    UNDER_REVIEW: { label: 'Under Review', className: 'bg-orange-100 text-orange-800 border-orange-200' },
    COMPLETED: { label: 'Completed', className: 'bg-green-100 text-green-800 border-green-200' },
    CANCELLED: { label: 'Cancelled', className: 'bg-red-100 text-red-800 border-red-200' },
    SUBMITTED: { label: 'Submitted', className: 'bg-slate-100 text-slate-700 border-slate-200' },
    DRAFT: { label: 'Draft', className: 'bg-gray-100 text-gray-600 border-gray-200' },
    FAILED: { label: 'Failed', className: 'bg-red-100 text-red-800 border-red-200' },
    PAID: { label: 'Paid', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    PENDING: { label: 'Pending', className: 'bg-amber-100 text-amber-800 border-amber-200' },
    VERIFIED: { label: 'Paid', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    PARTIAL: { label: 'Partial', className: 'bg-amber-100 text-amber-700 border-amber-200' },
    REFUNDED: { label: 'Refunded', className: 'bg-red-100 text-red-700 border-red-200' },
    NORMAL: { label: 'Normal', className: 'bg-slate-100 text-slate-600 border-slate-200' },
    URGENT: { label: 'Urgent', className: 'bg-red-100 text-red-700 border-red-200' },
    HIGH: { label: 'High', className: 'bg-orange-100 text-orange-700 border-orange-200' },
    STANDARD: { label: 'Standard', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  };
  return map[status] || { label: status, className: 'bg-slate-100 text-slate-700 border-slate-200' };
}

// ─── Date Helper ────────────────────────────────────────────────────────

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateStr);
}

// ─── Navigation Items ────────────────────────────────────────────────────

const NAV_ITEMS: { id: CustomerView; label: string; icon: React.ElementType }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'requests', label: 'Requests', icon: FileText },
  { id: 'cases', label: 'Cases', icon: Briefcase },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'profile', label: 'Profile', icon: User },
];

// ─── Main Shell ─────────────────────────────────────────────────────────

export default function CustomerShell({ children }: { children: React.ReactNode }) {
  const [activeView, setActiveView] = useState<CustomerView>('home');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const memberName = profile?.member?.displayName || 'Customer';
  const unreadCount = notifications.filter((n) => !n.read).length;

  // Demo login on mount
  useEffect(() => {
    async function init() {
      try {
        const authRes = await fetch('/api/customer/auth?action=demo', { method: 'POST' });
        if (authRes.ok) {
          const authData = await authRes.json();
          // Store token for subsequent Authorization header auth
          if (authData.token) {
            setAuthToken('customer', authData.token);
          }
          setIsLoggedIn(true);
          // Fetch profile
          const profileRes = await fetch('/api/customer/profile', {
            headers: authData.token ? { 'Authorization': `Bearer ${authData.token}` } : undefined,
          });
          if (profileRes.ok) {
            const profileData = await profileRes.json();
            setProfile(profileData);
          }
          // Fetch notifications
          const notifRes = await fetch('/api/customer/notifications', {
            headers: authData.token ? { 'Authorization': `Bearer ${authData.token}` } : undefined,
          });
          if (notifRes.ok) {
            const notifData = await notifRes.json();
            setNotifications(notifData.data || []);
          }
        }
      } catch (err) {
        console.error('Init failed:', err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('asoju-customer-token') : null;
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/customer/notifications', { headers });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.data || []);
      }
    } catch { /* ignore */ }
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/customer/auth?action=logout', { method: 'POST' });
      clearAuthToken('customer');
      setIsLoggedIn(false);
      setProfile(null);
      setNotifications([]);
      setActiveView('home');
    } catch { /* ignore */ }
  };

  const navigate = useCallback((view: CustomerView) => {
    setActiveView(view);
    setMobileMenuOpen(false);
  }, []);

  const openCaseDetail = useCallback((caseId: string) => {
    setSelectedCaseId(caseId);
    setActiveView('case-detail');
    setMobileMenuOpen(false);
  }, []);

  const contextValue: CustomerContextValue = {
    activeView,
    setActiveView: navigate,
    selectedCaseId,
    setSelectedCaseId,
    profile,
    setProfile,
    notifications,
    setNotifications,
    refreshNotifications,
    isLoggedIn,
    setIsLoggedIn,
    memberName,
  };

  // Breadcrumb helper
  const getBreadcrumb = () => {
    switch (activeView) {
      case 'home': return [{ label: 'Dashboard' }];
      case 'requests': return [{ label: 'Dashboard', onClick: () => navigate('home') }, { label: 'Service Requests' }];
      case 'new-request': return [{ label: 'Dashboard', onClick: () => navigate('home') }, { label: 'Requests', onClick: () => navigate('requests') }, { label: 'New Request' }];
      case 'cases': return [{ label: 'Dashboard', onClick: () => navigate('home') }, { label: 'Cases' }];
      case 'case-detail': return [{ label: 'Dashboard', onClick: () => navigate('home') }, { label: 'Cases', onClick: () => navigate('cases') }, { label: 'Case Detail' }];
      case 'billing': return [{ label: 'Dashboard', onClick: () => navigate('home') }, { label: 'Billing' }];
      case 'messages': return [{ label: 'Dashboard', onClick: () => navigate('home') }, { label: 'Messages' }];
      case 'profile': return [{ label: 'Dashboard', onClick: () => navigate('home') }, { label: 'Profile' }];
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <ChatProvider
      user={profile ? { userId: profile.member.id, role: 'CUSTOMER' as const, displayName: profile.member.displayName } : null}
      enabled={isLoggedIn}
    >
    <CustomerContext.Provider value={contextValue}>
      <div className="min-h-screen flex flex-col bg-background">
        {/* ─── Top Navigation Bar ─────────────────────────────────────── */}
        <header className="sticky top-0 z-50 bg-white border-b shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between h-14 sm:h-16">
              {/* Left: Brand + Mobile menu */}
              <div className="flex items-center gap-3">
                {/* Mobile hamburger */}
                <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                  <SheetTrigger asChild className="lg:hidden">
                    <Button variant="ghost" size="icon" className="shrink-0">
                      <Menu className="h-5 w-5" />
                      <span className="sr-only">Menu</span>
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-72 p-0">
                    <SheetHeader className="px-4 py-4 border-b bg-emerald-50">
                      <SheetTitle className="flex items-center gap-2 text-emerald-800">
                        <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                          <span className="text-white font-bold text-sm">A</span>
                        </div>
                        ASOJU
                      </SheetTitle>
                    </SheetHeader>
                    <nav className="flex flex-col p-2 gap-1 mt-2">
                      {NAV_ITEMS.map((item) => (
                        <Button
                          key={item.id}
                          variant={activeView === item.id ? 'secondary' : 'ghost'}
                          className="justify-start gap-3 h-10 px-3"
                          onClick={() => navigate(item.id)}
                        >
                          <item.icon className="h-4 w-4" />
                          {item.label}
                          {item.id === 'home' && unreadCount > 0 && (
                            <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0 h-5 min-w-5">
                              {unreadCount}
                            </Badge>
                          )}
                        </Button>
                      ))}
                    </nav>
                    <div className="absolute bottom-0 left-0 right-0 p-4 border-t">
                      <Button
                        variant="ghost"
                        className="w-full justify-start gap-3 text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={handleLogout}
                      >
                        <LogOut className="h-4 w-4" />
                        Sign Out
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>

                {/* Brand */}
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                    <span className="text-white font-bold text-sm">A</span>
                  </div>
                  <div className="hidden sm:block">
                    <h1 className="text-base font-semibold text-gray-900 leading-tight">ASOJU</h1>
                    <p className="text-[10px] text-gray-500 leading-tight -mt-0.5">Customer Portal</p>
                  </div>
                </div>
              </div>

              {/* Center: Desktop Nav */}
              <nav className="hidden lg:flex items-center gap-1">
                {NAV_ITEMS.map((item) => (
                  <Button
                    key={item.id}
                    variant={activeView === item.id ? 'secondary' : 'ghost'}
                    className={`gap-2 text-sm h-9 ${activeView === item.id ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : ''}`}
                    onClick={() => navigate(item.id)}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Button>
                ))}
              </nav>

              {/* Right: Notifications + User */}
              <div className="flex items-center gap-2">
                {/* Notification Bell */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative">
                      <Bell className="h-4 w-4" />
                      {unreadCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                      <span className="sr-only">Notifications</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-80">
                    <div className="flex items-center justify-between px-3 py-2 border-b">
                      <span className="font-semibold text-sm">Notifications</span>
                      {unreadCount > 0 && (
                        <Badge variant="secondary" className="text-[10px]">{unreadCount} new</Badge>
                      )}
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                          No notifications yet
                        </div>
                      ) : (
                        notifications.slice(0, 8).map((n) => (
                          <DropdownMenuItem
                            key={n.id}
                            className={`flex flex-col items-start gap-1 p-3 cursor-pointer ${!n.read ? 'bg-emerald-50/50' : ''}`}
                            onClick={async () => {
                              if (!n.read) {
                                await authFetch('/api/customer/notifications', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ notificationId: n.id }),
                                });
                                refreshNotifications();
                              }
                            }}
                          >
                            <div className="flex items-center gap-2 w-full">
                              <span className="text-sm font-medium truncate flex-1">{n.title}</span>
                              {!n.read && <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />}
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                            <span className="text-[10px] text-muted-foreground">{formatRelativeTime(n.createdAt)}</span>
                          </DropdownMenuItem>
                        ))
                      )}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* User Avatar + Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="flex items-center gap-2 pl-1 pr-2">
                      <Avatar className="h-7 w-7">
                        <AvatarImage src={profile?.member?.avatarUrl || undefined} alt={memberName} />
                        <AvatarFallback className="bg-emerald-100 text-emerald-700 text-xs font-semibold">
                          {memberName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="hidden sm:block text-sm font-medium text-gray-700 max-w-24 truncate">{memberName}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <div className="px-3 py-2 border-b">
                      <p className="text-sm font-medium">{memberName}</p>
                      <p className="text-xs text-muted-foreground">{profile?.member?.email}</p>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate('profile')}>
                      <User className="mr-2 h-4 w-4" />
                      Profile
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign Out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>

          {/* Breadcrumb */}
          <div className="border-t bg-gray-50/50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
              <nav className="flex items-center gap-1 h-8 text-xs" aria-label="Breadcrumb">
                {getBreadcrumb().map((crumb, idx) => (
                  <React.Fragment key={idx}>
                    {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                    <button
                      onClick={crumb.onClick}
                      className={`hover:text-emerald-700 transition-colors ${
                        idx === getBreadcrumb().length - 1
                          ? 'font-medium text-gray-700'
                          : 'text-muted-foreground'
                      } ${!crumb.onClick ? 'pointer-events-none' : ''}`}
                    >
                      {crumb.label}
                    </button>
                  </React.Fragment>
                ))}
              </nav>
            </div>
          </div>
        </header>

        {/* ─── Main Content ──────────────────────────────────────────── */}
        <main className="flex-1">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
            {children}
          </div>
        </main>

        {/* ─── Footer ───────────────────────────────────────────────── */}
        <footer className="border-t bg-white mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
              <p>&copy; {new Date().getFullYear()} ASOJU FieldForce. All rights reserved.</p>
              <p>Customer Portal v1.0</p>
            </div>
          </div>
        </footer>
      </div>
    </CustomerContext.Provider>
    </ChatProvider>
  );
}


