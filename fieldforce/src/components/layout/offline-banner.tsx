'use client';

import { WifiOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function OfflineBanner() {
  const { isOnline, offlineQueue, setIsOnline } = useAppStore();

  const hasQueue = offlineQueue.length > 0;
  const showBanner = !isOnline || hasQueue;

  if (!showBanner) return null;

  return (
    <div
      className={cn(
        'relative z-50 flex items-center justify-between px-4 py-2 text-sm font-medium transition-all',
        !isOnline
          ? 'bg-amber-50 text-amber-800 border-b border-amber-200'
          : 'bg-sky-50 text-sky-800 border-b border-sky-200'
      )}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        {!isOnline ? (
          <>
            <WifiOff className="w-4 h-4 flex-shrink-0" />
            <span>You are offline. Actions will be queued.</span>
          </>
        ) : hasQueue ? (
          <>
            <RefreshCw className="w-4 h-4 flex-shrink-0 animate-spin" />
            <span>
              Syncing {offlineQueue.length} item{offlineQueue.length !== 1 ? 's' : ''}...
            </span>
          </>
        ) : null}
      </div>

      {!isOnline && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => {
            // Force check online status
            setIsOnline(navigator.onLine);
          }}
        >
          <AlertTriangle className="w-3 h-3 mr-1" />
          Retry
        </Button>
      )}

      {/* Pending items count badge */}
      {hasQueue && (
        <div className="flex items-center gap-1.5">
          <span className="bg-current/15 text-current text-xs font-bold px-1.5 py-0.5 rounded-full">
            {offlineQueue.length}
          </span>
        </div>
      )}
    </div>
  );
}
