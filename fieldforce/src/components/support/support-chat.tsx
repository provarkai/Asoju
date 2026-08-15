'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';
import {
  Send,
  Paperclip,
  Camera,
  FileText,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppStore } from '@/lib/store';
import { fetchSupportMessages, sendSupportMessage, escalateMission } from '@/lib/asoju-api';
import type { SupportMessage, Mission } from '@/lib/types';

// ─── Date Separator ──────────────────────────────────────────────────────

function DateSeparator({ date }: { date: Date }) {
  let label: string;
  if (isToday(date)) {
    label = 'Today';
  } else if (isYesterday(date)) {
    label = 'Yesterday';
  } else {
    label = format(date, 'MMM d, yyyy');
  }

  return (
    <div className="flex items-center justify-center py-3">
      <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

// ─── Typing Indicator ────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 px-4 pb-2">
      <div className="rounded-2xl rounded-bl-sm bg-gray-100 px-4 py-3 dark:bg-gray-800">
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

// ─── Message Bubble ──────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: SupportMessage }) {
  const isAgent = msg.sender === 'AGENT';
  const time = format(new Date(msg.createdAt), 'h:mm a');

  return (
    <div
      className={`flex ${isAgent ? 'justify-end' : 'justify-start'} px-4 pb-1`}
    >
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 shadow-sm ${
          isAgent
            ? 'rounded-br-sm bg-green-600 text-white'
            : 'rounded-bl-sm bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
        }`}
      >
        {msg.attachmentUrl && (
          <div className="mb-2">
            {msg.attachmentType === 'IMAGE' ? (
              <img
                src={msg.attachmentUrl}
                alt="Attachment"
                className="max-h-48 rounded-lg object-contain"
              />
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-black/10 p-2">
                <FileText className="h-4 w-4" />
                <span className="text-xs underline">View Attachment</span>
              </div>
            )}
          </div>
        )}
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
          {msg.message}
        </p>
        <p
          className={`mt-1 text-right text-[10px] ${
            isAgent ? 'text-green-100' : 'text-gray-400'
          }`}
        >
          {time}
        </p>
      </div>
    </div>
  );
}

// ─── Escalate Dialog ─────────────────────────────────────────────────────

function EscalateDialog({ missions }: { missions: Mission[] }) {
  const [open, setOpen] = useState(false);
  const [selectedMission, setSelectedMission] = useState<string>('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!selectedMission || !reason.trim()) return;
    setLoading(true);
    try {
      await escalateMission({ caseId: selectedMission, reason: reason.trim() });
      setOpen(false);
      setSelectedMission('');
      setReason('');
    } catch {
      // Error handled silently — could add toast
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="destructive"
          size="sm"
          className="gap-1.5 text-xs font-semibold"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Escalate Mission
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Escalate Mission</DialogTitle>
          <DialogDescription className="text-xs">
            Raise an urgent issue with the ASOJU operations team for a specific mission.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="escalate-mission" className="text-xs">
              Select Mission
            </Label>
            <Select value={selectedMission} onValueChange={setSelectedMission}>
              <SelectTrigger id="escalate-mission" className="w-full">
                <SelectValue placeholder="Choose a mission..." />
              </SelectTrigger>
              <SelectContent>
                {missions.map((m) => (
                  <SelectItem key={m.caseId} value={m.caseId}>
                    {m.title} — {m.lga}, {m.state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="escalate-reason" className="text-xs">
              Reason for Escalation
            </Label>
            <Textarea
              id="escalate-reason"
              placeholder="Describe the issue..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleSubmit}
            disabled={!selectedMission || !reason.trim() || loading}
          >
            {loading ? 'Escalating...' : 'Escalate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Support Chat Component ─────────────────────────────────────────

export default function SupportChat() {
  const { agent, missions, supportMessages, setSupportMessages, addSupportMessage, isOnline } =
    useAppStore();

  const [messageText, setMessageText] = useState('');
  const [selectedMissionId, setSelectedMissionId] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showTyping, setShowTyping] = useState(false);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [supportMessages, showTyping, scrollToBottom]);

  // Fetch messages on mount
  useEffect(() => {
    let cancelled = false;
    async function loadMessages() {
      try {
        setLoading(true);
        const data = await fetchSupportMessages(
          selectedMissionId || undefined
        );
        if (!cancelled) {
          setSupportMessages(data as SupportMessage[]);
        }
      } catch {
        // Silently handle fetch errors
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadMessages();
    return () => {
      cancelled = true;
    };
  }, [selectedMissionId, setSupportMessages]);

  // Simulate typing indicator after agent sends a message
  useEffect(() => {
    const lastMsg = supportMessages[supportMessages.length - 1];
    if (lastMsg && lastMsg.sender === 'AGENT') {
      const timer = setTimeout(() => setShowTyping(true), 500);
      const hideTimer = setTimeout(() => setShowTyping(false), 3000);
      return () => {
        clearTimeout(timer);
        clearTimeout(hideTimer);
      };
    }
  }, [supportMessages]);

  const handleSend = async () => {
    if (!messageText.trim() && !attachmentFile) return;
    setSending(true);
    try {
      const newMsg = await sendSupportMessage({
        message: messageText.trim(),
        missionId: selectedMissionId || undefined,
        attachment: attachmentFile || undefined,
      });
      addSupportMessage(newMsg as SupportMessage);
      setMessageText('');
      setAttachmentFile(null);
    } catch {
      // Could add toast notification here
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAttachmentFile(file);
    }
    e.target.value = '';
  };

  // Group messages by date for separators
  const renderMessages = () => {
    if (loading) {
      return (
        <div className="space-y-4 px-4 py-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}
            >
              <Skeleton className="h-16 w-48 rounded-2xl" />
            </div>
          ))}
        </div>
      );
    }

    if (supportMessages.length === 0) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-50 dark:bg-green-900/20">
            <Send className="h-7 w-7 text-green-600" />
          </div>
          <h3 className="mb-1 text-sm font-semibold text-foreground">
            No messages yet
          </h3>
          <p className="max-w-[260px] text-xs text-muted-foreground">
            Start a conversation with ASOJU operations. We typically respond within
            minutes.
          </p>
        </div>
      );
    }

    let lastDate: Date | null = null;
    const elements: React.ReactNode[] = [];

    supportMessages.forEach((msg, idx) => {
      const msgDate = new Date(msg.createdAt);

      if (!lastDate || !isSameDay(msgDate, lastDate)) {
        elements.push(<DateSeparator key={`date-${idx}`} date={msgDate} />);
        lastDate = msgDate;
      }

      elements.push(<MessageBubble key={msg.id} msg={msg} />);
    });

    return elements;
  };

  const activeMissions = missions.filter(
    (m) =>
      m.workflowState !== 'COMPLETED' &&
      m.workflowState !== 'CANCELLED' &&
      m.workflowState !== 'FAILED' &&
      m.workflowState !== 'REASSIGNED'
  );

  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col bg-white dark:bg-gray-950">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-600 text-sm font-bold text-white">
              AO
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                ASOJU Support
              </h2>
              <p className="text-[11px] text-green-600">● Online</p>
            </div>
          </div>
          <EscalateDialog missions={activeMissions} />
        </div>

        {/* Mission filter selector */}
        {activeMissions.length > 0 && (
          <div className="mt-3">
            <Select value={selectedMissionId} onValueChange={setSelectedMissionId}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue placeholder="All Messages (no mission filter)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Messages</SelectItem>
                {activeMissions.map((m) => (
                  <SelectItem key={m.caseId} value={m.caseId}>
                    <div className="flex items-center gap-1.5">
                      <ChevronRight className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {m.title} — {m.lga}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <Separator />

      {/* ── Messages Area ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto py-2">
        {renderMessages()}
        {showTyping && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Attachment Preview ───────────────────────────────── */}
      {attachmentFile && (
        <div className="border-t px-4 py-2">
          <div className="flex items-center gap-2 rounded-lg bg-muted p-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 truncate text-xs text-foreground">
              {attachmentFile.name}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-destructive hover:text-destructive"
              onClick={() => setAttachmentFile(null)}
            >
              Remove
            </Button>
          </div>
        </div>
      )}

      {/* ── Input Area ───────────────────────────────────────── */}
      <div className="border-t bg-white px-3 py-2 dark:bg-gray-950">
        <div className="mb-1.5 flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,.doc,.docx"
            className="hidden"
            onChange={handleFileSelect}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || !isOnline}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => cameraInputRef.current?.click()}
            disabled={sending || !isOnline}
          >
            <Camera className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Input
            placeholder={isOnline ? 'Type a message...' : 'Offline — messages will queue'}
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
            className="flex-1 text-sm"
          />
          <Button
            size="icon"
            className="h-9 w-9 shrink-0 rounded-full bg-green-600 hover:bg-green-700"
            onClick={handleSend}
            disabled={(!messageText.trim() && !attachmentFile) || sending}
          >
            <Send className="h-4 w-4 text-white" />
          </Button>
        </div>
      </div>
    </div>
  );
}
