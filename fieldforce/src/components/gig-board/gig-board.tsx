'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Briefcase, RefreshCw, SearchX, ChevronDown } from 'lucide-react';
import { fetchAvailableGigs, acceptGig, declineGig } from '@/lib/asoju-api';
import { useAppStore } from '@/lib/store';
import type { Gig } from '@/lib/types';
import { GigCard, GigCardSkeleton } from '@/components/gig-board/gig-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ─── Empty State Illustration ────────────────────────────────────────────────

function EmptyState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-4">
        <SearchX className="w-10 h-10 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-1">
        No Gigs Available
      </h3>
      <p className="text-sm text-muted-foreground max-w-[260px] mb-6">
        There are no gigs available in your area right now. Check back soon — new
        gigs are posted regularly!
      </p>
      <Button variant="outline" onClick={onRefresh} className="gap-2">
        <RefreshCw className="w-4 h-4" />
        Refresh
      </Button>
    </div>
  );
}

// ─── Filter Tabs ────────────────────────────────────────────────────────────

function LgaFilterTabs({
  lgas,
  activeLga,
  onSelect,
}: {
  lgas: string[];
  activeLga: string;
  onSelect: (lga: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (lgas.length <= 1) return null;

  return (
    <div
      ref={scrollRef}
      className="flex gap-2 overflow-x-auto scrollbar-none px-1 pb-1 -mx-1"
    >
      <button
        onClick={() => onSelect('all')}
        className={cn(
          'shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border',
          activeLga === 'all'
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-background text-muted-foreground border-border hover:bg-muted'
        )}
      >
        All
      </button>
      {lgas.map((lga) => (
        <button
          key={lga}
          onClick={() => onSelect(lga)}
          className={cn(
            'shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border',
            activeLga === lga
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background text-muted-foreground border-border hover:bg-muted'
          )}
        >
          {lga}
        </button>
      ))}
    </div>
  );
}

// ─── Pull-to-Refresh Indicator ───────────────────────────────────────────────

function PullToRefreshIndicator({ isRefreshing }: { isRefreshing: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2 py-3 text-xs font-medium text-muted-foreground transition-opacity',
        isRefreshing ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}
    >
      <RefreshCw
        className={cn('w-4 h-4', isRefreshing && 'animate-spin')}
      />
      {isRefreshing ? 'Refreshing gigs…' : 'Pull to refresh'}
    </div>
  );
}

// ─── Gig Board ───────────────────────────────────────────────────────────────

export function GigBoard() {
  const { gigs, setGigs, removeGig, agent } = useAppStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [activeLga, setActiveLga] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Extract unique LGAs from gigs ────────────────────────────────────────
  const uniqueLgas = useMemo(() => {
    const lgaSet = new Set(gigs.map((g) => g.lga));
    return Array.from(lgaSet).sort();
  }, [gigs]);

  // ── Filter gigs by selected LGA ──────────────────────────────────────────
  const filteredGigs = useMemo(() => {
    if (activeLga === 'all') return gigs;
    return gigs.filter((g) => g.lga === activeLga);
  }, [gigs, activeLga]);

  // ── Fetch gigs ───────────────────────────────────────────────────────────
  const loadGigs = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const data = await fetchAvailableGigs();
      setGigs(data as Gig[]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load gigs'
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [setGigs]);

  useEffect(() => {
    loadGigs();
  }, [loadGigs]);

  // ── Accept gig ──────────────────────────────────────────────────────────
  const handleAccept = useCallback(
    async (caseId: string) => {
      setAcceptingId(caseId);
      try {
        await acceptGig(caseId);
        removeGig(caseId);
      } catch (err) {
        // Error handling could be enhanced with a toast
        console.error('Failed to accept gig:', err);
      } finally {
        setAcceptingId(null);
      }
    },
    [removeGig]
  );

  // ── Decline gig ─────────────────────────────────────────────────────────
  const handleDecline = useCallback(
    async (caseId: string) => {
      try {
        await declineGig(caseId);
        removeGig(caseId);
      } catch (err) {
        console.error('Failed to decline gig:', err);
      }
    },
    [removeGig]
  );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="flex flex-col gap-4">
      {/* Pull-to-refresh indicator */}
      <PullToRefreshIndicator isRefreshing={isRefreshing} />

      {/* Error banner */}
      {error && !isLoading && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">Failed to load gigs</p>
          <p className="text-xs mt-0.5">{error}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-8 text-xs text-red-700 hover:text-red-800 hover:bg-red-100"
            onClick={() => loadGigs(true)}
          >
            <RefreshCw className="w-3 h-3 mr-1" />
            Retry
          </Button>
        </div>
      )}

      {/* LGA Filter tabs */}
      {!isLoading && gigs.length > 0 && (
        <LgaFilterTabs
          lgas={uniqueLgas}
          activeLga={activeLga}
          onSelect={setActiveLga}
        />
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex flex-col gap-4">
          {[1, 2, 3].map((i) => (
            <GigCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && gigs.length === 0 && !error && (
        <EmptyState onRefresh={() => loadGigs(true)} />
      )}

      {/* Filtered empty state */}
      {!isLoading && gigs.length > 0 && filteredGigs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
          <SearchX className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            No gigs available in{' '}
            <span className="font-semibold text-foreground">{activeLga}</span>{' '}
            right now.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 text-xs"
            onClick={() => setActiveLga('all')}
          >
            Show all LGAs
          </Button>
        </div>
      )}

      {/* Gig list */}
      {!isLoading && filteredGigs.length > 0 && (
        <>
          {/* Gig count header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {filteredGigs.length}{' '}
                {filteredGigs.length === 1 ? 'gig' : 'gigs'} available
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => loadGigs(true)}
              disabled={isRefreshing}
            >
              <RefreshCw
                className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')}
              />
              Refresh
            </Button>
          </div>

          <div className="flex flex-col gap-4">
            {filteredGigs.map((gig) => (
              <GigCard
                key={gig.caseId}
                gig={gig}
                onAccept={handleAccept}
                onDecline={handleDecline}
                isLoading={acceptingId === gig.caseId}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
