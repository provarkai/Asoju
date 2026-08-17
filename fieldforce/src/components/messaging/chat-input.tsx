'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useChatContext } from './chat-provider';
import { Paperclip, Send, Loader2, AlertCircle, X, Reply } from 'lucide-react';

interface ReplyToInfo {
  id: string;
  senderName: string;
  content: string | null;
}

interface ChatInputProps {
  currentUserId: string;
  currentUserRole: string;
  threadType?: 'DIRECT' | 'RELAYED';
  replyTo: ReplyToInfo | null;
  onCancelReply: () => void;
  onSendReply: (replyToId: string, content: string) => void;
}

export function ChatInput({
  currentUserId,
  currentUserRole,
  threadType = 'DIRECT',
  replyTo,
  onCancelReply,
  onSendReply,
}: ChatInputProps) {
  const {
    activeThread,
    sendMessage,
    sendFileMessage,
    uploadFile,
    startTyping,
    stopTyping,
    error,
  } = useChatContext();

  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isRelayed = threadType === 'RELAYED';
  const canSendText = !(isRelayed && (currentUserRole === 'AGENT' || currentUserRole === 'CUSTOMER'));

  const handleSend = useCallback(() => {
    if (!text.trim() || !activeThread || !canSendText) return;

    if (replyTo) {
      onSendReply(replyTo.id, text.trim());
      onCancelReply();
    } else {
      sendMessage(activeThread.id, text.trim());
    }

    stopTyping(activeThread.id);
    setText('');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Clear typing timer
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
  }, [text, activeThread, sendMessage, stopTyping, canSendText, replyTo, onSendReply, onCancelReply]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);

    // Auto-resize textarea (max 4 lines)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const maxHeight = 4 * 24; // ~4 lines
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`;
    }

    // Typing indicators
    if (activeThread) {
      startTyping(activeThread.id);

      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
      typingTimerRef.current = setTimeout(() => {
        if (activeThread) stopTyping(activeThread.id);
      }, 2000);
    }
  }, [activeThread, startTyping, stopTyping]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeThread) return;

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    try {
      setUploading(true);
      const result = await uploadFile(file);
      sendFileMessage(activeThread.id, result.url, result.fileName, result.fileSize, result.fileType);
    } catch (err) {
      console.error('[Chat] File upload failed:', err);
    } finally {
      setUploading(false);
    }
  }, [activeThread, uploadFile, sendFileMessage]);

  if (!activeThread) return null;

  const replyPreview = replyTo?.content
    ? replyTo.content.length > 50
      ? replyTo.content.slice(0, 50) + '…'
      : replyTo.content
    : 'File attachment';

  return (
    <TooltipProvider>
      <div className="border-t px-3 py-2 shrink-0 bg-background">
        {/* Reply-to bar */}
        {replyTo && (
          <div className="flex items-start gap-2 px-2.5 py-2 mb-2 bg-primary/5 border-l-2 border-l-primary rounded-r-lg">
            <Reply className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-primary leading-tight">
                Replying to {replyTo.senderName}
              </p>
              <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                {replyPreview}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="w-6 h-6 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={onCancelReply}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}

        {/* Relayed warning */}
        {isRelayed && !canSendText && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 mb-2 bg-violet-50 text-violet-700 text-[11px] rounded-lg">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>
              Direct text chat is not available for relayed threads. You can share files only.
            </span>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 mb-2 bg-red-50 text-red-600 text-[11px] rounded-lg">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Input area */}
        <div className="flex items-end gap-2">
          {/* File upload */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileSelect}
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Paperclip className="w-4 h-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Attach file</TooltipContent>
          </Tooltip>

          {/* Text input */}
          {canSendText ? (
            <Textarea
              ref={textareaRef}
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              placeholder={replyTo ? `Reply to ${replyTo.senderName}...` : 'Type a message...'}
              className={cn(
                'min-h-[36px] max-h-[96px] resize-none text-sm px-3 py-2 rounded-xl',
                'bg-muted border-0 focus-visible:ring-1 focus-visible:ring-primary/20'
              )}
              rows={1}
              disabled={!activeThread}
            />
          ) : (
            <div className="flex-1 text-xs text-muted-foreground px-3 py-2.5 bg-muted rounded-xl">
              Text chat is not available for this relayed thread.
            </div>
          )}

          {/* Send button */}
          {(canSendText && text.trim()) ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  className="w-8 h-8 shrink-0 rounded-full"
                  onClick={handleSend}
                  disabled={!text.trim()}
                >
                  <Send className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Send (Enter)</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              size="icon"
              className="w-8 h-8 shrink-0 rounded-full"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Paperclip className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
