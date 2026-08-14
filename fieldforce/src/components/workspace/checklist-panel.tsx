'use client';

import { useState, useRef, useMemo } from 'react';
import {
  Camera,
  SquareCheckBig,
  Pencil,
  ChevronDown,
  ChevronUp,
  RotateCw,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import type { Mission, ChecklistItem, CaseScope } from '@/lib/types';

// ─── Props ──────────────────────────────────────────────────────────────────

interface ChecklistPanelProps {
  mission: Mission;
  onUpdateChecklist: (
    checklistId: string,
    completed: boolean,
    value?: string,
    photoUrl?: string
  ) => void;
}

type SyncStatus = 'synced' | 'queued';

// ─── Component ──────────────────────────────────────────────────────────────

export function ChecklistPanel({ mission, onUpdateChecklist }: ChecklistPanelProps) {
  const { isOnline, offlineQueue } = useAppStore();
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);

  // Parse checklist from scopeSnapshot
  const scopeData = mission.scopeSnapshot;
  const checklist = scopeData?.checklist ?? [];
  const objectives = scopeData?.objectives ?? [];
  const exclusions = scopeData?.exclusions ?? [];
  const specialInstructions = scopeData?.specialInstructions;

  // Calculate completion progress
  const { completed, total, percentage } = useMemo(() => {
    const t = checklist.length;
    const c = checklist.filter((item) => item.completed).length;
    return {
      completed: c,
      total: t,
      percentage: t > 0 ? Math.round((c / t) * 100) : 0,
    };
  }, [checklist]);

  // Derive sync status for each checklist item from the offline queue
  const getSyncStatus = (checklistId: string): SyncStatus => {
    if (!isOnline) return 'queued';
    const hasQueuedOp = offlineQueue.some(
      (item) =>
        item.operationType === 'CHECKLIST_UPDATE' &&
        item.payload.checklistId === checklistId
    );
    return hasQueuedOp ? 'queued' : 'synced';
  };

  const handleCheckboxToggle = (item: ChecklistItem) => {
    onUpdateChecklist(item.id, !item.completed);
  };

  const handlePhotoCapture = (item: ChecklistItem, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const photoUrl = URL.createObjectURL(file);
      onUpdateChecklist(item.id, true, undefined, photoUrl);
    }
    if (cameraInputRef.current) {
      cameraInputRef.current.value = '';
    }
    setActivePhotoId(null);
  };

  const handleOpenCamera = (itemId: string) => {
    setActivePhotoId(itemId);
    setTimeout(() => {
      cameraInputRef.current?.click();
    }, 100);
  };

  const handleNoteChange = (item: ChecklistItem, value: string) => {
    const completed = value.trim().length > 0;
    onUpdateChecklist(item.id, completed, value);
  };

  const getTypeIcon = (type: ChecklistItem['type']) => {
    switch (type) {
      case 'photo':
        return <Camera className="w-4 h-4 text-sky-500" />;
      case 'note':
        return <Pencil className="w-4 h-4 text-violet-500" />;
      case 'boolean':
        return <SquareCheckBig className="w-4 h-4 text-green-500" />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Progress Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">
            Checklist Progress
          </h3>
          <span
            className={cn(
              'text-sm font-bold',
              percentage === 100 ? 'text-green-600' : 'text-foreground'
            )}
          >
            {completed}/{total} items
          </span>
        </div>
        <Progress
          value={percentage}
          className={cn(
            'h-3 rounded-full',
            percentage === 100 && '[&>[data-slot=progress-indicator]]:bg-green-500'
          )}
        />
        <p className="text-xs text-muted-foreground text-center">
          {percentage === 100
            ? '✓ All items completed — ready to submit'
            : `${percentage}% complete`}
        </p>
      </div>

      {/* Objectives Section */}
      {objectives.length > 0 && (
        <Alert className="border-green-200 bg-green-50">
          <SquareCheckBig className="w-4 h-4 text-green-600" />
          <AlertTitle className="text-green-800 font-bold text-sm">
            Objectives
          </AlertTitle>
          <AlertDescription className="text-green-700">
            <ul className="list-disc list-inside space-y-1 mt-1">
              {objectives.map((obj, i) => (
                <li key={i} className="text-xs leading-relaxed">
                  {obj}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Special Instructions */}
      {specialInstructions && (
        <Alert className="border-sky-200 bg-sky-50">
          <AlertTriangle className="w-4 h-4 text-sky-600" />
          <AlertTitle className="text-sky-800 font-bold text-sm">
            Special Instructions
          </AlertTitle>
          <AlertDescription className="text-sky-700 text-xs leading-relaxed">
            {specialInstructions}
          </AlertDescription>
        </Alert>
      )}

      {/* Exclusions Section */}
      {exclusions.length > 0 && (
        <Alert className="border-amber-200 bg-amber-50">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <AlertTitle className="text-amber-800 font-bold text-sm">
            Exclusions
          </AlertTitle>
          <AlertDescription className="text-amber-700">
            <ul className="list-disc list-inside space-y-1 mt-1">
              {exclusions.map((ex, i) => (
                <li key={i} className="text-xs leading-relaxed">
                  {ex}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Hidden camera input (reused for all photo items) */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          if (activePhotoId) {
            const item = checklist.find((c) => c.id === activePhotoId);
            if (item) handlePhotoCapture(item, e);
          }
        }}
      />

      {/* Checklist Items */}
      <div className="space-y-2">
        {checklist.map((item) => {
          const syncStatus = getSyncStatus(item.id);
          const isNoteExpanded = expandedNote === item.id;

          return (
            <Card
              key={item.id}
              className={cn(
                'transition-all border-2',
                item.completed
                  ? 'border-green-200 bg-green-50/50'
                  : 'border-border'
              )}
            >
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  {/* Checkbox (for boolean items) or type indicator */}
                  <div className="flex-shrink-0 pt-0.5">
                    {item.type === 'boolean' ? (
                      <Checkbox
                        checked={item.completed}
                        onCheckedChange={() => handleCheckboxToggle(item)}
                        className="w-6 h-6 rounded-md"
                        aria-label={`Mark "${item.label}" as ${item.completed ? 'incomplete' : 'complete'}`}
                      />
                    ) : item.type === 'photo' ? (
                      <button
                        onClick={() => handleOpenCamera(item.id)}
                        className={cn(
                          'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                          item.completed
                            ? 'bg-sky-100 text-sky-600'
                            : 'bg-muted text-muted-foreground hover:bg-sky-100 hover:text-sky-600'
                        )}
                        aria-label={`Take photo for "${item.label}"`}
                      >
                        <Camera className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          setExpandedNote(isNoteExpanded ? null : item.id)
                        }
                        className={cn(
                          'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                          item.completed
                            ? 'bg-violet-100 text-violet-600'
                            : 'bg-muted text-muted-foreground hover:bg-violet-100 hover:text-violet-600'
                        )}
                        aria-label={`Edit note for "${item.label}"`}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Item content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Label
                        className={cn(
                          'text-sm font-semibold leading-snug',
                          item.completed && 'line-through text-muted-foreground'
                        )}
                      >
                        {item.label}
                      </Label>
                      {getTypeIcon(item.type)}
                    </div>

                    {/* Photo preview */}
                    {item.type === 'photo' && item.photoUrl && (
                      <div className="mt-2 relative inline-block">
                        <img
                          src={item.photoUrl}
                          alt={`Evidence for ${item.label}`}
                          className="w-20 h-20 rounded-lg object-cover border-2 border-sky-200"
                        />
                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      </div>
                    )}

                    {/* Photo capture button (if not yet captured) */}
                    {item.type === 'photo' && !item.completed && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 h-10 text-xs border-sky-300 text-sky-700 hover:bg-sky-50"
                        onClick={() => handleOpenCamera(item.id)}
                      >
                        <Camera className="w-3.5 h-3.5 mr-1" />
                        Take Photo
                      </Button>
                    )}

                    {/* Note input (expanded) */}
                    {item.type === 'note' && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-1 h-7 text-xs text-muted-foreground px-1"
                          onClick={() =>
                            setExpandedNote(isNoteExpanded ? null : item.id)
                          }
                        >
                          {isNoteExpanded ? (
                            <>
                              <ChevronUp className="w-3 h-3 mr-1" />
                              Collapse
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3 h-3 mr-1" />
                              {item.value ? 'Edit Note' : 'Add Note'}
                            </>
                          )}
                        </Button>

                        {isNoteExpanded && (
                          <Textarea
                            value={item.value ?? ''}
                            onChange={(e) => handleNoteChange(item, e.target.value)}
                            placeholder="Enter your notes here..."
                            className="mt-2 min-h-[80px] text-sm border-violet-200 focus-visible:border-violet-400 focus-visible:ring-violet-200"
                          />
                        )}

                        {item.value && !isNoteExpanded && (
                          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                            {item.value}
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  {/* Sync status indicator */}
                  <div className="flex-shrink-0 pt-1">
                    {syncStatus === 'synced' ? (
                      <span className="text-green-500 text-xs flex items-center gap-1" title="Synced">
                        <Check className="w-3 h-3" />
                      </span>
                    ) : (
                      <span className="text-amber-500 text-xs flex items-center gap-1" title="Queued for sync">
                        <RotateCw className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Empty state */}
      {checklist.length === 0 && (
        <div className="text-center py-8">
          <SquareCheckBig className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No checklist items for this mission.</p>
        </div>
      )}
    </div>
  );
}
