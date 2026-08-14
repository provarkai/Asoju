'use client';

import { useState, useCallback, Suspense, lazy } from 'react';
import { Shield, Users, Building2, Smartphone, ArrowRight, HardHat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AppShell } from '@/components/layout/app-shell';

// Lazy load all three experiences
const AgentPortal = lazy(() => import('./stateful-app'));
const AdminDashboard = lazy(() =>
  import('@/components/admin/admin-shell').then(m => ({ default: m.AdminShell }))
);
const CustomerShell = lazy(() =>
  import('@/components/customer/customer-shell').then(m => ({ default: m.default }))
);
const CustomerContent = lazy(() =>
  import('@/components/customer/customer-content').then(m => ({ default: m.CustomerContent }))
);
const PreProdDashboard = lazy(() =>
  import('@/components/preprod/preprod-dashboard').then(m => ({ default: m.PreProdDashboard }))
);

// ─── Portal Types ──────────────────────────────────────────────────────

export type PortalExperience = 'agent' | 'admin' | 'customer' | 'preprod';

interface PortalConfig {
  id: PortalExperience;
  title: string;
  subtitle: string;
  description: string;
  icon: React.ElementType;
  badge: string;
  badgeColor: string;
  gradient: string;
}

const PORTALS: PortalConfig[] = [
  {
    id: 'agent',
    title: 'Field Agent Portal',
    subtitle: 'For Field Agents',
    description: 'Browse gigs, execute missions, capture evidence, track earnings, and manage your field operations.',
    icon: Smartphone,
    badge: 'PWA',
    badgeColor: 'bg-sky-100 text-sky-700 border-sky-200',
    gradient: 'from-sky-500/10 to-sky-600/5',
  },
  {
    id: 'admin',
    title: 'Admin Dashboard',
    subtitle: 'For Operations Team',
    description: 'Manage customers, cases, field execution, evidence QC, quotes, payments, analytics, and governance.',
    icon: Shield,
    badge: 'INTERNAL',
    badgeColor: 'bg-violet-100 text-violet-700 border-violet-200',
    gradient: 'from-violet-500/10 to-violet-600/5',
  },
  {
    id: 'customer',
    title: 'Customer Portal',
    subtitle: 'For Service Recipients',
    description: 'Track service delivery progress, view completion updates, receive deliverables, and stay informed about your field service requests.',
    icon: Building2,
    badge: 'B2B2C',
    badgeColor: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    gradient: 'from-emerald-500/10 to-emerald-600/5',
  },
  {
    id: 'preprod',
    title: 'Pre-Production Audit',
    subtitle: 'Readiness Report',
    description: 'Comprehensive gap analysis and scoping for production readiness. Security, infrastructure, frontend, devops, data, and performance audit.',
    icon: HardHat,
    badge: 'AUDIT',
    badgeColor: 'bg-red-100 text-red-700 border-red-200',
    gradient: 'from-red-500/10 to-red-600/5',
  },
];

// ─── Loading Fallback ────────────────────────────────────────────────────

function PortalLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Loading experience...</p>
      </div>
    </div>
  );
}

// ─── Back to Portal Button ──────────────────────────────────────────────

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onBack}
      className="fixed top-4 right-4 z-[100] gap-2 shadow-sm bg-white"
    >
      <ArrowRight className="w-4 h-4 rotate-180" />
      Switch Portal
    </Button>
  );
}

// ─── Portal Selection Screen ────────────────────────────────────────────

function PortalSelector({ onSelect }: { onSelect: (portal: PortalExperience) => void }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex flex-col">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">ASOJU Platform</h1>
              <p className="text-xs sm:text-sm text-muted-foreground">FieldForce &bull; Admin &bull; Customer</p>
            </div>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl">
            Select the experience you&apos;d like to access. Each portal is a purpose-built interface optimized for its role.
          </p>
        </div>
      </header>

      {/* Portal Cards */}
      <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 w-full">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PORTALS.map((portal) => {
            const Icon = portal.icon;
            return (
              <Card
                key={portal.id}
                className="group cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-1 border-2 hover:border-primary/30"
                onClick={() => onSelect(portal.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between mb-3">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${portal.gradient} flex items-center justify-center border`}>
                      <Icon className="w-6 h-6 text-foreground" />
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${portal.badgeColor}`}>
                      {portal.badge}
                    </span>
                  </div>
                  <CardTitle className="text-lg leading-tight">{portal.title}</CardTitle>
                  <CardDescription className="text-sm">{portal.subtitle}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                    {portal.description}
                  </p>
                  <Button variant="outline" className="w-full gap-2 group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-colors">
                    Enter Portal
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Footer info */}
        <div className="mt-12 text-center">
          <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>All systems operational</span>
            </div>
            <span>&bull;</span>
            <span>ASOJU v4.0</span>
            <span>&bull;</span>
            <span>Nigeria</span>
          </div>
        </div>
      </main>

      {/* Sticky Footer */}
      <footer className="border-t bg-white mt-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} ASOJU FieldForce. All rights reserved.</p>
            <p>Field workforce management for reliable local service delivery</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Main Portal Router ────────────────────────────────────────────────

export default function PortalRouter() {
  const [activePortal, setActivePortal] = useState<PortalExperience | null>(null);

  // Initialize from stored preference
  const [initialized, setInitialized] = useState(false);
  if (!initialized && typeof window !== 'undefined') {
    const stored = localStorage.getItem('asoju-portal');
    if (stored === 'agent' || stored === 'admin' || stored === 'customer' || stored === 'preprod') {
      setActivePortal(stored);
    }
    setInitialized(true);
  }

  const handleSelectPortal = (portal: PortalExperience) => {
    localStorage.setItem('asoju-portal', portal);
    setActivePortal(portal);
  };

  const handleBackToPortal = () => {
    setActivePortal(null);
    localStorage.removeItem('asoju-portal');
  };

  if (!activePortal) {
    return <PortalSelector onSelect={handleSelectPortal} />;
  }

  return (
    <>
      <BackButton onBack={handleBackToPortal} />
      <Suspense fallback={<PortalLoader />}>
        {activePortal === 'agent' && <AgentWrapper />}
        {activePortal === 'admin' && <AdminDashboard />}
        {activePortal === 'customer' && (
          <CustomerShell>
            <CustomerContent />
          </CustomerShell>
        )}
        {activePortal === 'preprod' && <PreProdDashboard onBack={handleBackToPortal} />}
      </Suspense>
    </>
  );
}

// ─── Agent Portal Wrapper ──────────────────────────────────────────────
// Wraps the existing agent portal with its AppShell

function AgentWrapper() {
  return (
    <AppShell>
      <Suspense fallback={<PortalLoader />}>
        <AgentPortal />
      </Suspense>
    </AppShell>
  );
}
