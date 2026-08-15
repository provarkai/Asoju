'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Activity,
  BarChart3,
  ScrollText,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Menu,
  MessageCircle,
  Wallet,
  Send,
  HeartPulse,
  Heart,
  MapPin,
  FileCheck,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { AdminSection } from './admin-types';
import { setAuthToken, clearAuthToken } from '@/lib/auth-fetch';
import { ChatProvider } from '@/components/messaging/chat-provider';

// Lazy-loaded section components
import { lazy, Suspense } from 'react';

const CommandCenter = lazy(() =>
  import('./command-center').then((m) => ({ default: m.CommandCenter }))
);
const CustomerList = lazy(() =>
  import('./customer-list').then((m) => ({ default: m.CustomerList }))
);
const CaseList = lazy(() =>
  import('./case-list').then((m) => ({ default: m.CaseList }))
);
const OperationsPanel = lazy(() =>
  import('./operations-panel').then((m) => ({ default: m.OperationsPanel }))
);
const AnalyticsPanel = lazy(() =>
  import('./analytics-panel').then((m) => ({ default: m.AnalyticsPanel }))
);
const AuditLog = lazy(() =>
  import('./audit-log').then((m) => ({ default: m.AuditLog }))
);
const ChatAdminView = lazy(() =>
  import('@/components/messaging/chat-admin-view').then((m) => ({ default: m.default }))
);
const FinanceDashboard = lazy(() =>
  import('./finance-dashboard').then((m) => ({ default: m.FinanceDashboard }))
);
const OutboxPanel = lazy(() =>
  import('./outbox-panel').then((m) => ({ default: m.OutboxPanel }))
);
const SystemHealthPanel = lazy(() =>
  import('./system-health-panel').then((m) => ({ default: m.SystemHealthPanel }))
);
const TrustScorePanel = lazy(() =>
  import('./trust-score-panel').then((m) => ({ default: m.TrustScorePanel }))
);
const CarePlansPanel = lazy(() =>
  import('./care-plans-panel').then((m) => ({ default: m.CarePlansPanel }))
);
const LiveTrackingPanel = lazy(() =>
  import('./live-tracking-panel').then((m) => ({ default: m.LiveTrackingPanel }))
);
const ServiceReportsPanel = lazy(() =>
  import('./service-reports-panel').then((m) => ({ default: m.ServiceReportsPanel }))
);
const SosPanel = lazy(() =>
  import('./sos-panel').then((m) => ({ default: m.SosPanel }))
);

// ─── Navigation Items ──────────────────────────────────────────────────

interface NavItem {
  id: AdminSection;
  label: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'command-center', label: 'Command Center', icon: LayoutDashboard },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'cases', label: 'Cases', icon: Briefcase },
  { id: 'operations', label: 'Operations', icon: Activity },
  { id: 'finance', label: 'Finance', icon: Wallet },
  { id: 'messages', label: 'Messages', icon: MessageCircle },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'audit', label: 'Audit Log', icon: ScrollText },
  { id: 'outbox', label: 'Event Outbox', icon: Send },
  { id: 'system', label: 'System Health', icon: HeartPulse },
  { id: 'trust', label: 'Trust Scores', icon: Shield },
  { id: 'care-plans', label: 'Care Plans', icon: Heart },
  { id: 'tracking', label: 'Live Tracking', icon: MapPin },
  { id: 'reports', label: 'Service Reports', icon: FileCheck },
  { id: 'sos', label: 'SOS Alerts', icon: AlertTriangle },
];

// ─── Sidebar Navigation (shared between desktop & mobile drawer) ────────

function SidebarNav({
  activeSection,
  onNavigate,
  collapsed,
  adminInfo,
  onLogout,
}: {
  activeSection: AdminSection;
  onNavigate: (id: AdminSection) => void;
  collapsed: boolean;
  adminInfo: { displayName: string; email: string; role: string } | null;
  onLogout: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Branding */}
      <div className="flex items-center gap-3 px-4 h-16 border-b shrink-0">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <span className="text-primary-foreground font-bold text-xs">AF</span>
        </div>
        {!collapsed && (
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-sm truncate">ASOJU</span>
            <span className="text-[11px] text-muted-foreground -mt-0.5">Admin Dashboard</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-3">
        <nav className="flex flex-col gap-1 px-3">
          {!collapsed && (
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2">
              Navigation
            </p>
          )}
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            const button = (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
            if (collapsed) {
              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>{button}</TooltipTrigger>
                  <TooltipContent side="right" className="font-medium">
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              );
            }
            return button;
          })}
        </nav>
      </ScrollArea>

      {/* User Info */}
      <div className="border-t p-3 shrink-0">
        {adminInfo && (
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
              <span className="text-xs font-semibold text-muted-foreground">
                {adminInfo.displayName?.charAt(0)?.toUpperCase() || 'A'}
              </span>
            </div>
            {!collapsed && (
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-medium truncate">{adminInfo.displayName}</span>
                <Badge variant="secondary" className="w-fit text-[10px] px-1.5 py-0 mt-0.5">
                  {adminInfo.role}
                </Badge>
              </div>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={onLogout}
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side={collapsed ? 'right' : 'top'}>
                Logout
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Loading Fallback ────────────────────────────────────────────────────

function SectionLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ─── Admin Shell ─────────────────────────────────────────────────────────

export function AdminShell() {
  const [activeSection, setActiveSection] = useState<AdminSection>('command-center');
  const [adminInfo, setAdminInfo] = useState<{ id: string; displayName: string; email: string; role: string } | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Demo login on mount
  const handleLogin = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/auth?action=demo', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          setAuthToken('admin', data.token);
        }
        setAdminInfo(data.admin);
        setAuthenticated(true);
      }
    } catch (err) {
      console.error('Demo login failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/admin/auth?action=logout', { method: 'POST' });
      clearAuthToken('admin');
      setAdminInfo(null);
      setAuthenticated(false);
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }, []);

  useEffect(() => {
    handleLogin();
  }, [handleLogin]);

  // Navigate and close mobile menu
  const handleNavigate = useCallback((id: AdminSection) => {
    setActiveSection(id);
    setMobileMenuOpen(false);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Initializing Admin Dashboard...</p>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Shield className="w-12 h-12 text-muted-foreground" />
          <p className="text-lg font-medium">Admin authentication required</p>
          <Button onClick={handleLogin}>Connect to Demo</Button>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={0}>
      <ChatProvider
        user={adminInfo ? { userId: adminInfo.id, role: 'ADMIN' as const, displayName: adminInfo.displayName } : null}
        enabled={authenticated}
      >
      <div className="min-h-screen bg-background flex">
        {/* ─── Desktop Sidebar (hidden below lg) ─── */}
        <aside
          className={`hidden lg:flex sticky top-0 h-screen flex-col border-r bg-card transition-all duration-200 ${
            sidebarCollapsed ? 'w-[68px]' : 'w-[260px]'
          }`}
        >
          <SidebarNav
            activeSection={activeSection}
            onNavigate={setActiveSection}
            collapsed={sidebarCollapsed}
            adminInfo={adminInfo}
            onLogout={handleLogout}
          />
        </aside>

        {/* ─── Mobile/Tablet Drawer (shown below lg) ─── */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="fixed top-3 left-3 z-[90] lg:hidden shadow-sm bg-white border"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="w-5 h-5" />
              <span className="sr-only">Menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[280px] p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            <SidebarNav
              activeSection={activeSection}
              onNavigate={handleNavigate}
              collapsed={false}
              adminInfo={adminInfo}
              onLogout={handleLogout}
            />
          </SheetContent>
        </Sheet>

        {/* ─── Main Content ─── */}
        <main className="flex-1 min-h-screen flex flex-col overflow-hidden">
          {/* Top Bar */}
          <header className="h-14 border-b bg-card flex items-center justify-between px-4 sm:px-6 shrink-0">
            <div className="flex items-center gap-3">
              {/* Desktop collapse toggle */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hidden lg:flex w-8 h-8"
                    onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  >
                    {sidebarCollapsed ? (
                      <PanelLeftOpen className="w-4 h-4" />
                    ) : (
                      <PanelLeftClose className="w-4 h-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                </TooltipContent>
              </Tooltip>

              {/* Spacer for mobile hamburger */}
              <div className="w-8 lg:hidden" />

              <Separator orientation="vertical" className="h-5 hidden lg:block" />
              <h1 className="text-base sm:text-lg font-semibold truncate">
                {NAV_ITEMS.find((n) => n.id === activeSection)?.label || 'Dashboard'}
              </h1>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              {adminInfo && (
                <>
                  <Badge variant="outline" className="hidden sm:inline-flex text-[10px]">
                    {adminInfo.role}
                  </Badge>
                  <span className="text-sm text-muted-foreground hidden md:inline truncate max-w-[200px]">
                    {adminInfo.email}
                  </span>
                </>
              )}
            </div>
          </header>

          {/* Content Area */}
          <div className="flex-1 overflow-auto p-4 sm:p-6">
            <Suspense fallback={<SectionLoader />}>
              {activeSection === 'command-center' && <CommandCenter />}
              {activeSection === 'customers' && <CustomerList />}
              {activeSection === 'cases' && <CaseList />}
              {activeSection === 'operations' && <OperationsPanel />}
              {activeSection === 'finance' && <FinanceDashboard />}
              {activeSection === 'analytics' && <AnalyticsPanel />}
              {activeSection === 'messages' && <ChatAdminView adminId={adminInfo?.id || ''} />}
              {activeSection === 'audit' && <AuditLog />}
              {activeSection === 'outbox' && <OutboxPanel />}
              {activeSection === 'system' && <SystemHealthPanel />}
              {activeSection === 'trust' && <TrustScorePanel />}
              {activeSection === 'care-plans' && <CarePlansPanel />}
              {activeSection === 'tracking' && <LiveTrackingPanel />}
              {activeSection === 'reports' && <ServiceReportsPanel />}
              {activeSection === 'sos' && <SosPanel />}
            </Suspense>
          </div>
        </main>
      </div>
      </ChatProvider>
    </TooltipProvider>
  );
}

export default AdminShell;
