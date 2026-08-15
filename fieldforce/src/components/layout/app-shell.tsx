'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { OfflineBanner } from './offline-banner';
import { BottomNav } from './bottom-nav';
import { Header } from './header';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isOnline, setIsOnline, isOnboarded } = useAppStore();

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    setIsOnline(navigator.onLine);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setIsOnline]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Offline Sync Banner */}
      <OfflineBanner />

      {/* Header */}
      <Header />

      {/* Main Content Area */}
      <main className="flex-1 pb-20 overflow-y-auto">
        <div className="mx-auto max-w-lg">
          {children}
        </div>
      </main>

      {/* Bottom Navigation */}
      <BottomNav />
    </div>
  );
}
