'use client';

import {
  Briefcase,
  ClipboardList,
  Wallet,
  User,
  MessageSquare,
  MessageCircle,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import type { AppTab } from '@/lib/types';
import { cn } from '@/lib/utils';

const tabs: { id: AppTab; label: string; icon: React.ElementType }[] = [
  { id: 'gigs', label: 'Gigs', icon: Briefcase },
  { id: 'missions', label: 'Missions', icon: ClipboardList },
  { id: 'messages', label: 'Messages', icon: MessageCircle },
  { id: 'earnings', label: 'Earnings', icon: Wallet },
  { id: 'support', label: 'Support', icon: MessageSquare },
  { id: 'profile', label: 'Profile', icon: User },
];

export function BottomNav() {
   const { activeTab, setActiveTab, missions } = useAppStore();

  // Count active missions for badge
  const activeMissions = missions.filter(
    (m) =>
      m.workflowState !== 'COMPLETED' &&
      m.workflowState !== 'CANCELLED' &&
      m.workflowState !== 'FAILED' &&
      m.workflowState !== 'REASSIGNED'
  ).length;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border safe-area-bottom"
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="mx-auto max-w-lg flex items-center justify-around h-16 px-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 py-1 px-3 rounded-lg transition-all min-w-[56px] relative',
                isActive
                  ? 'text-primary font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <div className="relative">
                <Icon
                  className={cn(
                    'w-5 h-5 transition-all',
                    isActive && 'scale-110'
                  )}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                {/* Badge for active missions */}
                {tab.id === 'missions' && activeMissions > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {activeMissions > 9 ? '9+' : activeMissions}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  'text-[10px] leading-tight',
                  isActive ? 'font-semibold' : 'font-medium'
                )}
              >
                {tab.label}
              </span>
              {isActive && (
                <div className="absolute -top-px left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
