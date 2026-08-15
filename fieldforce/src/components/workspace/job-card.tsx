'use client';

import { useMemo } from 'react';
import { MapPin, Clock, AlertTriangle, ChevronRight, Banknote } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  WORKFLOW_STATE_LABELS,
  WORKFLOW_STATE_COLORS,
  SERVICE_TYPE_LABELS,
} from '@/lib/types';
import type { Mission, MissionPriority } from '@/lib/types';

// ─── Priority Colors ───────────────────────────────────────────────────────

const MISSION_PRIORITY_COLORS: Record<MissionPriority, string> = {
  NORMAL: 'bg-slate-100 text-slate-700 border-slate-200',
  URGENT: 'bg-amber-100 text-amber-800 border-amber-200',
  CRITICAL: 'bg-red-100 text-red-800 border-red-200',
};

// ─── Props ──────────────────────────────────────────────────────────────────

interface MissionCardProps {
  mission: Mission;
  onClick: () => void;
  onEscalate: (caseId: string) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTimeRemaining(deadline: string): {
  text: string;
  urgent: boolean;
  expired: boolean;
} {
  const now = Date.now();
  const deadlineMs = new Date(deadline).getTime();
  const diffMs = deadlineMs - now;

  if (diffMs <= 0) {
    return { text: 'Overdue', urgent: true, expired: true };
  }

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours < 2) {
    return {
      text: `${hours}h ${minutes}m left`,
      urgent: true,
      expired: false,
    };
  }

  if (hours < 24) {
    return {
      text: `${hours}h ${minutes}m left`,
      urgent: false,
      expired: false,
    };
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return {
    text: `${days}d ${remainingHours}h left`,
    urgent: false,
    expired: false,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MissionCard({ mission, onClick, onEscalate }: MissionCardProps) {
  const sla = useMemo(() => getTimeRemaining(mission.slaDeadline), [mission.slaDeadline]);
  const progressPercent =
    mission.checklistTotal > 0
      ? Math.round((mission.checklistProgress / mission.checklistTotal) * 100)
      : 0;

  const serviceLabel =
    SERVICE_TYPE_LABELS[mission.serviceCode] ?? mission.serviceCode;
  const workflowLabel = WORKFLOW_STATE_LABELS[mission.workflowState];
  const workflowColor = WORKFLOW_STATE_COLORS[mission.workflowState];
  const priorityColor = MISSION_PRIORITY_COLORS[mission.priority];

  return (
    <Card
      className={cn(
        'transition-all active:scale-[0.98] cursor-pointer',
        mission.escalated && 'border-red-300 border-2',
        sla.expired && 'border-red-400 border-2',
        !mission.escalated && !sla.expired && 'hover:border-primary/40'
      )}
      onClick={onClick}
    >
      <CardContent className="p-4 space-y-3">
        {/* Top row: Title + Escalation */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-foreground leading-snug line-clamp-2">
              {mission.title}
            </h3>
          </div>
          {mission.escalated && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEscalate(mission.caseId);
              }}
              className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center"
              aria-label="Escalation details"
            >
              <AlertTriangle className="w-4 h-4 text-red-600" />
            </button>
          )}
        </div>

        {/* Badges row */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="text-[10px] font-semibold px-2 py-0.5">
            {serviceLabel}
          </Badge>
          <Badge className={cn('text-[10px] font-semibold px-2 py-0.5', workflowColor)}>
            {workflowLabel}
          </Badge>
          <Badge variant="outline" className={cn('text-[10px] font-semibold px-2 py-0.5', priorityColor)}>
            {mission.priority}
          </Badge>
          {mission.escalated && (
            <Badge variant="destructive" className="text-[10px] font-semibold px-2 py-0.5">
              ESCALATED
            </Badge>
          )}
        </div>

        {/* Location */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-primary" />
          <span className="truncate">
            {mission.lga}, {mission.state}
          </span>
        </div>

        {/* Details row: Payout + SLA */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <Banknote className="w-4 h-4 text-green-600" />
            <span className="text-sm font-bold text-green-700">
              ₦{mission.netPayout.toLocaleString()}
            </span>
          </div>
          <div
            className={cn(
              'flex items-center gap-1 text-xs font-semibold',
              sla.expired
                ? 'text-red-600'
                : sla.urgent
                  ? 'text-amber-600'
                  : 'text-muted-foreground'
            )}
          >
            <Clock className="w-3 h-3" />
            {sla.text}
          </div>
        </div>

        {/* Progress Bar */}
        {mission.checklistTotal > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {mission.checklistProgress}/{mission.checklistTotal} tasks
              </span>
              <span
                className={cn(
                  'font-semibold',
                  progressPercent === 100 ? 'text-green-600' : 'text-muted-foreground'
                )}
              >
                {progressPercent}%
              </span>
            </div>
            <Progress
              value={progressPercent}
              className={cn(
                'h-2 rounded-full',
                progressPercent === 100 &&
                  '[&>[data-slot=progress-indicator]]:bg-green-500'
              )}
            />
          </div>
        )}

        {/* Action hint */}
        <div className="flex items-center justify-end pt-1">
          <span className="text-xs text-muted-foreground flex items-center gap-0.5">
            Open <ChevronRight className="w-3 h-3" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// Keep backward export alias
export { MissionCard as JobCard };
