'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  Phone,
  AlertTriangle,
  RotateCw,
  Send,
  MapPin,
  CheckCircle,
  ClipboardCheck,
  FileImage,
  Clock,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  WORKFLOW_STATE_LABELS,
  WORKFLOW_STATE_COLORS,
  SERVICE_TYPE_LABELS,
} from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Mission, WorkflowState, CaseScope, ChecklistItem } from '@/lib/types';
import { gpsCheckIn, updateChecklist, uploadEvidence, escalateMission, submitMission } from '@/lib/asoju-api';

import { GpsCheckIn } from './gps-checkin';
import { ChecklistPanel } from './checklist-panel';
import { EvidenceCapture } from './evidence-capture';

// ─── Workflow Step Definitions ────────────────────────────────────────────────

// Primary workflow steps shown in the stepper
const WORKFLOW_STEPS: WorkflowState[] = [
  'ACCEPTED',
  'EN_ROUTE',
  'ON_SITE',
  'EXECUTING',
  'SUBMITTING',
  'SUBMITTED',
  'QC_REVIEW',
  'COMPLETED',
];

// Alternate (non-linear) states shown as badges
const ALTERNATE_STATES: WorkflowState[] = [
  'ESCALATED',
  'PAUSED',
  'REASSIGNED',
  'REWORK',
  'CANCELLED',
  'FAILED',
];

function getStepIndex(state: WorkflowState): number {
  return WORKFLOW_STEPS.indexOf(state);
}

function isAlternateState(state: WorkflowState): boolean {
  return ALTERNATE_STATES.includes(state);
}

// ─── SLA Countdown ───────────────────────────────────────────────────────────

function useSlaCountdown(deadline: string) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  const deadlineMs = new Date(deadline).getTime();
  const diffMs = deadlineMs - now;

  if (diffMs <= 0) return { text: 'Overdue', urgent: true, expired: true };

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours < 2) return { text: `${hours}h ${minutes}m left`, urgent: true, expired: false };
  if (hours < 24) return { text: `${hours}h ${minutes}m left`, urgent: false, expired: false };

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return { text: `${days}d ${remainingHours}h left`, urgent: false, expired: false };
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface ExecutionWorkspaceProps {
  mission: Mission;
  onBack: () => void;
}

// ─── Escalation Types & Severities ───────────────────────────────────────────

const ESCALATION_TYPES = [
  { value: 'SAFETY', label: 'Safety Concern' },
  { value: 'ACCESS', label: 'Access Issue' },
  { value: 'BENEFICIARY', label: 'Beneficiary Issue' },
  { value: 'SCOPE', label: 'Scope Mismatch' },
  { value: 'TECHNICAL', label: 'Technical Issue' },
  { value: 'OTHER', label: 'Other' },
];

const ESCALATION_SEVERITIES = [
  { value: 'LOW', label: 'Low', className: 'bg-slate-100 text-slate-700' },
  { value: 'MEDIUM', label: 'Medium', className: 'bg-amber-100 text-amber-700' },
  { value: 'HIGH', label: 'High', className: 'bg-orange-100 text-orange-700' },
  { value: 'CRITICAL', label: 'Critical', className: 'bg-red-100 text-red-700' },
];

// ─── Component ───────────────────────────────────────────────────────────────

export function ExecutionWorkspace({ mission, onBack }: ExecutionWorkspaceProps) {
  const { isOnline, updateMission, offlineQueue } = useAppStore();
  const [escalateReason, setEscalateReason] = useState('');
  const [escalateType, setEscalateType] = useState('');
  const [escalateSeverity, setEscalateSeverity] = useState('');
  const [escalateDialogOpen, setEscalateDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [gpsDistance, setGpsDistance] = useState<number | undefined>(undefined);

  const currentStepIndex = getStepIndex(mission.workflowState);
  const isAlternate = isAlternateState(mission.workflowState);
  const sla = useSlaCountdown(mission.slaDeadline);

  const isEnRoute = mission.workflowState === 'EN_ROUTE';
  const isOnSite = mission.workflowState === 'ON_SITE';
  const isExecuting = mission.workflowState === 'EXECUTING';
  const showChecklist = isOnSite || isExecuting;
  const showEvidence = isOnSite || isExecuting;

  // Parse checklist from scopeSnapshot
  const scopeData = useMemo<CaseScope | null>(() => {
    if (mission.scopeSnapshot) return mission.scopeSnapshot;
    // Fallback: try parsing as JSON string (checklistTemplate field mapped to scopeSnapshot)
    return null;
  }, [mission.scopeSnapshot]);

  const checklist = scopeData?.checklist ?? [];
  const isAllComplete =
    checklist.length > 0 && checklist.every((item) => item.completed);

  const serviceLabel =
    SERVICE_TYPE_LABELS[mission.serviceCode] ?? mission.serviceCode;

  // ─── GPS Check-In Handler ──────────────────────────────────────────────

  const handleCheckIn = useCallback(
    (lat: number, lng: number, accuracy: number) => {
      // Optimistic update
      updateMission(mission.caseId, {
        workflowState: 'ON_SITE',
      });

      if (mission.address) {
        setGpsDistance(accuracy);
      }

      // API call
      if (isOnline) {
        gpsCheckIn({
          caseId: mission.caseId,
          lat,
          lng,
          accuracy,
        }).catch((err) => {
          console.error('GPS check-in failed:', err);
        });
      } else {
        const { addToOfflineQueue } = useAppStore.getState();
        addToOfflineQueue({
          id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          missionId: mission.caseId,
          operationType: 'GPS_CHECKIN',
          payload: { caseId: mission.caseId, lat, lng, accuracy },
          idempotencyKey: `checkin-${mission.caseId}`,
          status: 'QUEUED',
          retryCount: 0,
          createdAt: new Date().toISOString(),
        });
      }
    },
    [mission.caseId, mission.address, isOnline, updateMission]
  );

  // ─── Checklist Update Handler ──────────────────────────────────────────

  const handleUpdateChecklist = useCallback(
    (
      checklistId: string,
      completed: boolean,
      value?: string,
      photoUrl?: string
    ) => {
      if (!scopeData) return;

      const updatedChecklist = scopeData.checklist.map((item) => {
        if (item.id === checklistId) {
          return { ...item, completed, value, photoUrl };
        }
        return item;
      });

      const completedCount = updatedChecklist.filter((i) => i.completed).length;
      const totalCount = updatedChecklist.length;

      const newState: WorkflowState =
        mission.workflowState === 'EN_ROUTE' || mission.workflowState === 'ON_SITE'
          ? 'EXECUTING'
          : mission.workflowState;

      updateMission(mission.caseId, {
        scopeSnapshot: {
          ...scopeData,
          checklist: updatedChecklist,
        },
        checklistProgress: completedCount,
        checklistTotal: totalCount,
        workflowState: newState,
      });

      // API call
      if (isOnline) {
        updateChecklist({
          caseId: mission.caseId,
          checklistId,
          completed,
          value,
          photoUrl,
          idempotencyKey: `checklist-${mission.caseId}-${checklistId}-${Date.now()}`,
        }).catch((err) => {
          console.error('Checklist update failed:', err);
        });
      } else {
        const { addToOfflineQueue } = useAppStore.getState();
        addToOfflineQueue({
          id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          missionId: mission.caseId,
          operationType: 'CHECKLIST_UPDATE',
          payload: { caseId: mission.caseId, checklistId, completed, value, photoUrl },
          idempotencyKey: `checklist-${mission.caseId}-${checklistId}`,
          status: 'QUEUED',
          retryCount: 0,
          createdAt: new Date().toISOString(),
        });
      }
    },
    [mission, scopeData, isOnline, updateMission]
  );

  // ─── Evidence Upload Handler ───────────────────────────────────────────

  const handleEvidenceUploaded = useCallback(
    (url: string, _metadata: object) => {
      updateMission(mission.caseId, {
        evidenceCount: mission.evidenceCount + 1,
        workflowState: 'SUBMITTING',
      });

      if (isOnline) {
        const formData = new FormData();
        formData.append('caseId', mission.caseId);
        formData.append('file', new Blob([], { type: 'image/jpeg' }), 'evidence.jpg');
        uploadEvidence(formData).catch((err) => {
          console.error('Evidence upload failed:', err);
        });
      } else {
        const { addToOfflineQueue } = useAppStore.getState();
        addToOfflineQueue({
          id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          missionId: mission.caseId,
          operationType: 'EVIDENCE_UPLOAD',
          payload: { caseId: mission.caseId, url },
          idempotencyKey: `evidence-${mission.caseId}-${Date.now()}`,
          status: 'QUEUED',
          retryCount: 0,
          createdAt: new Date().toISOString(),
        });
      }
    },
    [mission.caseId, mission.evidenceCount, isOnline, updateMission]
  );

  // ─── Submit Mission Handler ────────────────────────────────────────────

  const handleSubmitMission = useCallback(async () => {
    if (!isAllComplete) return;
    setSubmitting(true);

    try {
      await submitMission(mission.caseId);
      updateMission(mission.caseId, {
        workflowState: 'SUBMITTED',
        submittedAt: new Date().toISOString(),
      });
    } catch {
      // Fallback optimistic update
      updateMission(mission.caseId, {
        workflowState: 'SUBMITTED',
        submittedAt: new Date().toISOString(),
      });
    }

    setSubmitting(false);
  }, [isAllComplete, mission.caseId, updateMission]);

  // ─── Escalation Handler ────────────────────────────────────────────────

  const handleEscalate = useCallback(() => {
    if (!escalateReason.trim()) return;

    updateMission(mission.caseId, {
      escalated: true,
      escalationReason: escalateReason.trim(),
      escalationType: escalateType || undefined,
      escalationSeverity: escalateSeverity || undefined,
      workflowState: 'ESCALATED' as WorkflowState,
    });

    if (isOnline) {
      escalateMission({
        caseId: mission.caseId,
        reason: escalateReason.trim(),
        escalationType: escalateType || undefined,
        severity: escalateSeverity || undefined,
      }).catch((err) => {
        console.error('Escalation failed:', err);
      });
    } else {
      const { addToOfflineQueue } = useAppStore.getState();
      addToOfflineQueue({
        id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        missionId: mission.caseId,
        operationType: 'ESCALATION',
        payload: {
          caseId: mission.caseId,
          reason: escalateReason.trim(),
          escalationType: escalateType,
          severity: escalateSeverity,
        },
        idempotencyKey: `escalation-${mission.caseId}`,
        status: 'QUEUED',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      });
    }

    setEscalateReason('');
    setEscalateType('');
    setEscalateSeverity('');
    setEscalateDialogOpen(false);
  }, [escalateReason, escalateType, escalateSeverity, mission.caseId, isOnline, updateMission]);

  // ─── Offline Sync Retry ────────────────────────────────────────────────

  const handleRetrySync = useCallback(() => {
    // Trigger online check
    const { setIsOnline } = useAppStore.getState();
    setIsOnline(navigator.onLine);
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      {/* Offline Sync Banner */}
      {!isOnline && (
        <div className="sticky top-0 z-50 bg-amber-500 text-white px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4" />
            <span className="text-sm font-semibold">
              Offline — {offlineQueue.length} change(s) queued
            </span>
          </div>
          {offlineQueue.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-white hover:bg-amber-600"
              onClick={handleRetrySync}
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Retry
            </Button>
          )}
        </div>
      )}

      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b">
        <div className="px-4 py-3 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-lg"
            onClick={onBack}
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold truncate">{mission.title}</h1>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{serviceLabel}</span>
              <span>·</span>
              <span>{mission.lga}, {mission.state}</span>
            </div>
          </div>
          <Badge
            className={cn(
              'text-[10px] font-semibold px-2 py-0.5',
              WORKFLOW_STATE_COLORS[mission.workflowState]
            )}
          >
            {WORKFLOW_STATE_LABELS[mission.workflowState]}
          </Badge>
        </div>

        {/* SLA Countdown */}
        <div className="px-4 pb-2">
          <div
            className={cn(
              'flex items-center gap-1.5 text-xs font-semibold',
              sla.expired
                ? 'text-red-600'
                : sla.urgent
                  ? 'text-amber-600'
                  : 'text-muted-foreground'
            )}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>SLA: {sla.text}</span>
            <span className="ml-auto">₦{mission.netPayout.toLocaleString()}</span>
          </div>
        </div>

        {/* Workflow Stepper */}
        {!isAlternate && (
          <div className="px-4 pb-3">
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide pb-1">
              {WORKFLOW_STEPS.map((step, idx) => {
                const isActive = idx <= currentStepIndex;
                const isCurrent = idx === currentStepIndex;
                return (
                  <div key={step} className="flex items-center flex-shrink-0">
                    <div className="flex flex-col items-center gap-1">
                      <div
                        className={cn(
                          'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all',
                          isActive
                            ? isCurrent
                              ? 'bg-primary text-primary-foreground ring-2 ring-primary/30'
                              : 'bg-primary/80 text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {idx + 1}
                      </div>
                      <span
                        className={cn(
                          'text-[9px] whitespace-nowrap',
                          isActive ? 'font-semibold text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {WORKFLOW_STATE_LABELS[step]}
                      </span>
                    </div>
                    {idx < WORKFLOW_STEPS.length - 1 && (
                      <div
                        className={cn(
                          'w-6 h-0.5 mx-0.5 mt-[-12px]',
                          idx < currentStepIndex ? 'bg-primary/60' : 'bg-muted'
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Alternate State Badge */}
        {isAlternate && (
          <div className="px-4 pb-3">
            <Badge
              className={cn(
                'text-xs font-semibold px-3 py-1',
                WORKFLOW_STATE_COLORS[mission.workflowState]
              )}
            >
              {WORKFLOW_STATE_LABELS[mission.workflowState]}
            </Badge>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="px-4 py-4 space-y-6 pb-32 max-w-lg mx-auto">
        {/* Beneficiary Contact Card */}
        {mission.beneficiaryPhone && (
          <Card className="border-green-200 bg-green-50/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-green-600 font-semibold">Beneficiary</p>
                  <p className="text-sm font-bold text-foreground truncate">
                    {mission.beneficiaryName ?? 'Contact'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {mission.beneficiaryPhone}
                  </p>
                </div>
                <Button
                  className="h-12 w-12 rounded-full bg-green-600 hover:bg-green-700 text-white flex-shrink-0"
                  size="icon"
                  onClick={() => {
                    window.open(`tel:${mission.beneficiaryPhone}`, '_self');
                  }}
                  aria-label="Call beneficiary"
                >
                  <Phone className="w-5 h-5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* GPS Check-In Panel (when EN_ROUTE) */}
        {isEnRoute && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <h2 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              GPS Check-In
            </h2>
            <GpsCheckIn
              onCheckIn={handleCheckIn}
              isCheckedIn={mission.workflowState !== 'EN_ROUTE'}
              distance={gpsDistance}
            />
          </motion.div>
        )}

        {/* Execution Checklist Panel (when ON_SITE or EXECUTING) */}
        {showChecklist && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            <h2 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-primary" />
              Execution Checklist
            </h2>
            <ChecklistPanel
              mission={mission}
              onUpdateChecklist={handleUpdateChecklist}
            />
          </motion.div>
        )}

        {/* Evidence Capture Section */}
        {showEvidence && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
          >
            <h2 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
              <FileImage className="w-4 h-4 text-primary" />
              Evidence
            </h2>
            <EvidenceCapture
              missionId={mission.caseId}
              onEvidenceUploaded={handleEvidenceUploaded}
            />
          </motion.div>
        )}

        {/* Completed / Submitted State */}
        {(mission.workflowState === 'SUBMITTED' ||
          mission.workflowState === 'QC_REVIEW' ||
          mission.workflowState === 'COMPLETED') && (
          <Card className="border-green-200 bg-green-50/50">
            <CardContent className="p-6 text-center">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-green-800">
                {mission.workflowState === 'SUBMITTED' && 'Mission Submitted Successfully'}
                {mission.workflowState === 'QC_REVIEW' && 'Under Quality Review'}
                {mission.workflowState === 'COMPLETED' && 'Mission Completed'}
              </h3>
              <p className="text-sm text-green-600 mt-1">
                {mission.completedAt &&
                  `Completed at ${new Date(mission.completedAt).toLocaleString()}`}
              </p>
              <p className="text-sm font-bold text-green-700 mt-2">
                Payout: ₦{mission.netPayout.toLocaleString()}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Escalation Reason Display */}
        {mission.escalated && mission.escalationReason && (
          <Card className="border-red-200 bg-red-50/50">
            <CardContent className="p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-red-800">Escalated</h3>
                  <p className="text-xs text-red-600 mt-1">{mission.escalationReason}</p>
                  {mission.escalationType && (
                    <p className="text-xs text-red-500 mt-0.5">Type: {mission.escalationType}</p>
                  )}
                  {mission.escalationSeverity && (
                    <Badge className="mt-1 bg-red-100 text-red-700 text-[10px]">
                      {mission.escalationSeverity}
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Checklist Progress Summary */}
        {showChecklist && mission.checklistTotal > 0 && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  Overall Progress
                </span>
                <span className="text-xs font-bold text-foreground">
                  {mission.checklistProgress}/{mission.checklistTotal}
                </span>
              </div>
              <Progress
                value={
                  mission.checklistTotal > 0
                    ? (mission.checklistProgress / mission.checklistTotal) * 100
                    : 0
                }
                className="h-2.5 rounded-full"
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Bottom Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t px-4 py-3 z-30">
        <div className="max-w-lg mx-auto flex gap-3">
          {/* Escalate Button */}
          <Dialog open={escalateDialogOpen} onOpenChange={setEscalateDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="destructive"
                className="h-14 rounded-xl font-bold text-sm px-4 flex-shrink-0"
                size="lg"
              >
                <AlertTriangle className="w-5 h-5 mr-1.5" />
                Escalate
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="text-red-600">Escalate Mission</DialogTitle>
                <DialogDescription>
                  Describe the issue preventing you from completing this mission. An ASOJU
                  operations team member will follow up.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-2">
                  <Label htmlFor="escalate-type" className="text-sm font-semibold">
                    Escalation Type
                  </Label>
                  <Select value={escalateType} onValueChange={setEscalateType}>
                    <SelectTrigger id="escalate-type">
                      <SelectValue placeholder="Select type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {ESCALATION_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="escalate-severity" className="text-sm font-semibold">
                    Severity
                  </Label>
                  <div className="flex gap-2">
                    {ESCALATION_SEVERITIES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => setEscalateSeverity(s.value)}
                        className={cn(
                          'flex-1 py-2 px-2 rounded-lg text-xs font-semibold transition-all border',
                          escalateSeverity === s.value
                            ? cn(s.className, 'border-current ring-2 ring-current/20')
                            : 'bg-muted text-muted-foreground border-transparent'
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="escalate-reason" className="text-sm font-semibold">
                    Reason for Escalation
                  </Label>
                  <Textarea
                    id="escalate-reason"
                    placeholder="Describe the issue in detail..."
                    value={escalateReason}
                    onChange={(e) => setEscalateReason(e.target.value)}
                    className="min-h-[100px]"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEscalateDialogOpen(false);
                    setEscalateReason('');
                    setEscalateType('');
                    setEscalateSeverity('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleEscalate}
                  disabled={!escalateReason.trim()}
                >
                  Submit Escalation
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Submit Mission Button */}
          <Button
            className={cn(
              'flex-1 h-14 rounded-xl font-bold text-sm',
              isAllComplete
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            )}
            size="lg"
            disabled={!isAllComplete || submitting}
            onClick={handleSubmitMission}
          >
            {submitting ? (
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                >
                  <Send className="w-5 h-5 mr-2" />
                </motion.div>
                Submitting...
              </>
            ) : isAllComplete ? (
              <>
                <CheckCircle className="w-5 h-5 mr-2" />
                Submit Mission
              </>
            ) : (
              <>
                <ClipboardCheck className="w-5 h-5 mr-2" />
                Complete Checklist First ({mission.checklistProgress}/{mission.checklistTotal})
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
