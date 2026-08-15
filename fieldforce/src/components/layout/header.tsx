'use client';

import { Shield, WifiOff, Wifi } from 'lucide-react';
import { useAppStore } from '@/lib/store';

export function Header() {
  const { activeTab, agent } = useAppStore();

  const titles: Record<string, string> = {
    gigs: 'Available Gigs',
    missions: 'My Missions',
    earnings: 'Earnings',
    support: 'Support',
    profile: 'My Profile',
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-border">
      <div className="mx-auto max-w-lg px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 bg-primary rounded-lg">
            <Shield className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight text-foreground">
              ASOJU
            </h1>
            <p className="text-[10px] text-muted-foreground leading-tight">
              FieldForce
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Online/Offline indicator */}
          <NetworkIndicator />

          {/* Agent avatar */}
          {agent && (
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-xs font-bold text-primary">
                {agent.firstName[0]}
                {agent.lastName[0]}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Page title bar */}
      <div className="mx-auto max-w-lg px-4 pb-2">
        <p className="text-sm font-semibold text-foreground">
          {titles[activeTab] || 'Dashboard'}
        </p>
      </div>
    </header>
  );
}

function NetworkIndicator() {
  const { isOnline, offlineQueue } = useAppStore();

  if (isOnline && offlineQueue.length === 0) {
    return (
      <div className="flex items-center gap-1 text-emerald-600">
        <Wifi className="w-3.5 h-3.5" />
        <span className="text-[10px] font-medium hidden sm:inline">Online</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 text-amber-600">
      <WifiOff className="w-3.5 h-3.5" />
      <span className="text-[10px] font-medium hidden sm:inline">
        {isOnline ? 'Syncing...' : 'Offline'}
      </span>
    </div>
  );
}
