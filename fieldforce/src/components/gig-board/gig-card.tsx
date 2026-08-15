'use client';

import { useMemo } from 'react';
import { MapPin, Clock, Banknote, AlertTriangle, User, Phone } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SERVICE_TYPE_LABELS } from '@/lib/types';
import type { Gig } from '@/lib/types';
import { cn } from '@/lib/utils';

// ─── Priority Config ─────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  NORMAL: {
    label: 'Normal',
    className: 'bg-gray-100 text-gray-700 border-gray-200',
  },
  URGENT: {
    label: 'Urgent',
    className: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  CRITICAL: {
    label: 'Critical',
    className: 'bg-red-100 text-red-800 border-red-200',
  },
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface GigCardProps {
  gig: Gig;
  onAccept: (caseId: string) => void;
  onDecline: (caseId: string) => void;
  isLoading?: boolean;
}

// ─── SLA Countdown ──────────────────────────────────────────────────────────

function SlaCountdown({ deadline }: { deadline: string }) {
  const { text, isUrgent } = useMemo(() => {
    const now = Date.now();
    const deadlineMs = new Date(deadline).getTime();
    const diffMs = deadlineMs - now;
    const diffHours = diffMs / (1000 * 60 * 60);

    const text = formatDistanceToNow(new Date(deadline), { addSuffix: false });
    return { text: `${text} left`, isUrgent: diffHours < 12 };
  }, [deadline]);

  return (
    <span
      className={cn(
        'text-xs font-medium',
        isUrgent ? 'text-red-600' : 'text-muted-foreground'
      )}
    >
      <Clock className="w-3 h-3 inline mr-1" />
      {text}
    </span>
  );
}

// ─── Skeleton Loading State ──────────────────────────────────────────────────

export function GigCardSkeleton() {
  return (
    <Card className="gap-0 py-0 overflow-hidden">
      <CardHeader className="px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-24 rounded-md" />
            <Skeleton className="h-6 w-48 rounded-md" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-3">
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-36 rounded" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-28 rounded" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-32 rounded" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-28 rounded" />
        </div>
      </CardContent>
      <div className="px-4 pb-4 pt-2 border-t border-border">
        <div className="flex gap-2">
          <Skeleton className="h-11 flex-1 rounded-md" />
          <Skeleton className="h-11 flex-1 rounded-md" />
        </div>
      </div>
    </Card>
  );
}

// ─── Gig Card ────────────────────────────────────────────────────────────────

export function GigCard({ gig, onAccept, onDecline, isLoading }: GigCardProps) {
  const serviceLabel = SERVICE_TYPE_LABELS[gig.serviceCode] || gig.serviceCode;
  const priority = PRIORITY_CONFIG[gig.priority] || PRIORITY_CONFIG.NORMAL;

  return (
    <Card className="gap-0 py-0 overflow-hidden shadow-md transition-shadow hover:shadow-lg">
      {/* Header: Service type + Priority */}
      <CardHeader className="px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 space-y-1">
            <Badge variant="secondary" className="text-[10px] font-semibold">
              {serviceLabel}
            </Badge>
            <h3 className="text-base font-bold leading-tight text-foreground">
              {gig.title}
            </h3>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] font-semibold shrink-0',
              priority.className
            )}
          >
            {gig.priority === 'CRITICAL' && (
              <AlertTriangle className="w-3 h-3" />
            )}
            {priority.label}
          </Badge>
        </div>
      </CardHeader>

      {/* Details */}
      <CardContent className="px-4 pb-3 space-y-2.5">
        {/* Location */}
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
          <span>
            {gig.lga}, {gig.state}
          </span>
        </div>

        {/* Payout */}
        <div className="flex items-center gap-1.5">
          <Banknote className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-base font-bold text-emerald-600">
            ₦{gig.estimatedPayout.toLocaleString()}
          </span>
        </div>

        {/* SLA Deadline */}
        <SlaCountdown deadline={gig.slaDeadline} />

        {/* Beneficiary */}
        {gig.beneficiaryName && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <User className="w-4 h-4 shrink-0" />
            <span className="font-medium text-foreground">
              {gig.beneficiaryName}
            </span>
            {gig.beneficiaryPhone && (
              <a
                href={`tel:${gig.beneficiaryPhone}`}
                className="ml-auto text-primary font-medium flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <Phone className="w-3.5 h-3.5" />
                <span className="text-xs">{gig.beneficiaryPhone}</span>
              </a>
            )}
          </div>
        )}
      </CardContent>

      {/* Actions */}
      <div className="px-4 pb-4 pt-3 border-t border-border bg-muted/30">
        <div className="flex gap-2">
          <Button
            className="flex-1 h-11 text-sm font-semibold"
            onClick={() => onAccept(gig.caseId)}
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" />
                Accepting…
              </span>
            ) : (
              'Accept Gig'
            )}
          </Button>
          <Button
            variant="ghost"
            className="flex-1 h-11 text-sm font-medium"
            onClick={() => onDecline(gig.caseId)}
            disabled={isLoading}
          >
            Decline
          </Button>
        </div>
      </div>
    </Card>
  );
}
