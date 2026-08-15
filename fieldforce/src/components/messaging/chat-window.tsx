'use client';

import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useChatContext } from './chat-provider';
import {
  type ChatMessage,
  type ChatThread,
  type ChatReaction,
  getOtherParticipant,
  formatMessageTime,
  formatFullTime,
  formatFileSize,
  formatDateSeparator,
  isSameDay,
} from './types';
import {
  Check,
  CheckCheck,
  FileIcon,
  Download,
  ArrowRight,
  ArrowDown,
  Trash2,
  Reply,
  Smile,
  X,
} from 'lucide-react';

interface ChatWindowProps {
  currentUserId: string;
  replyTo: { id: string; senderName: string; content: string | null } | null;
  onSetReplyTo: (replyTo: { id: string; senderName: string; content: string | null } | null) => void;
  onDeleteMessage?: (messageId: string) => void;
  onAddReaction?: (messageId: string, emoji: string) => void;
}

const ROLE_STYLES: Record<string, string> = {
  AGENT: 'bg-amber-100 text-amber-800 border-amber-200',
  ADMIN: 'bg-slate-100 text-slate-700 border-slate-200',
  CUSTOMER: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

const SENDER_BORDER_COLORS: Record<string, string> = {
  AGENT: 'border-l-amber-500',
  ADMIN: 'border-l-slate-500',
  CUSTOMER: 'border-l-emerald-500',
};

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '👏', '🔥'];

// ─── Image Lightbox ─────────────────────────────────────────────────

function ImageLightbox({
  open,
  onOpenChange,
  src,
  alt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-auto p-2 bg-black/90 border-0 sm:p-4">
        <DialogTitle className="sr-only">Image Preview</DialogTitle>
        <img
          src={src}
          alt={alt}
          className="max-h-[80vh] max-w-full rounded-lg object-contain"
        />
      </DialogContent>
    </Dialog>
  );
}

// ─── Emoji Reaction Picker ──────────────────────────────────────────

function EmojiPicker({
  onPick,
  children,
}: {
  onPick: (emoji: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="end" side="top">
        <div className="flex flex-wrap gap-1">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => onPick(emoji)}
              className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-muted text-lg transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Reactions Row ──────────────────────────────────────────────────

function ReactionsRow({
  reactions,
  currentUserId,
  onReaction,
}: {
  reactions: ChatReaction[];
  currentUserId: string;
  onReaction: (emoji: string) => void;
}) {
  // Group by emoji
  const grouped = useMemo(() => {
    const map = new Map<string, { emoji: string; count: number; users: string[] }>();
    for (const r of reactions) {
      const existing = map.get(r.emoji);
      if (existing) {
        existing.count++;
        existing.users.push(r.user_id);
      } else {
        map.set(r.emoji, { emoji: r.emoji, count: 1, users: [r.user_id] });
      }
    }
    return Array.from(map.values());
  }, [reactions]);

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {grouped.map((g) => {
        const isOwn = g.users.includes(currentUserId);
        return (
          <button
            key={g.emoji}
            onClick={() => onReaction(g.emoji)}
            className={cn(
              'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs transition-colors border',
              isOwn
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'bg-muted/60 border-border text-muted-foreground hover:bg-muted'
            )}
          >
            <span className="text-sm leading-none">{g.emoji}</span>
            <span className="text-[10px] font-medium">{g.count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── File Message ───────────────────────────────────────────────────

function FileMessage({
  msg,
  onImagePreview,
}: {
  msg: ChatMessage;
  onImagePreview: (src: string, alt: string) => void;
}) {
  const fileUrl = msg.file_url
    ? msg.file_url.startsWith('http')
      ? msg.file_url
      : `/?XTransformPort=3005${msg.file_url}`
    : null;

  const isImage = msg.file_type?.startsWith('image/') && fileUrl;

  if (isImage) {
    return (
      <button
        type="button"
        onClick={() => onImagePreview(fileUrl!, msg.file_name || 'Image')}
        className="block group"
      >
        <img
          src={fileUrl}
          alt={msg.file_name || 'Image'}
          className="max-h-48 rounded-lg object-cover transition-opacity group-hover:opacity-90"
        />
      </button>
    );
  }

  return (
    <a
      href={fileUrl || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 p-2 rounded-lg bg-background/50 border hover:bg-background transition-colors min-w-[180px]"
    >
      <FileIcon className="w-5 h-5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{msg.file_name || 'File'}</p>
        <p className="text-[10px] text-muted-foreground">{formatFileSize(msg.file_size)}</p>
      </div>
      <Download className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </a>
  );
}

// ─── Reply-to Quote ─────────────────────────────────────────────────

function ReplyToQuote({
  replyTo,
  senderRole,
  onClick,
}: {
  replyTo: NonNullable<ChatMessage['_replyTo']>;
  senderRole: string;
  onClick: () => void;
}) {
  const preview = replyTo.content
    ? replyTo.content.length > 60
      ? replyTo.content.slice(0, 60) + '…'
      : replyTo.content
    : 'File attachment';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left border-l-2 pl-2 py-1 mb-1 rounded-r-sm bg-foreground/5 cursor-pointer hover:bg-foreground/10 transition-colors',
        SENDER_BORDER_COLORS[senderRole] || 'border-l-muted-foreground'
      )}
    >
      <p className="text-[10px] font-semibold text-muted-foreground leading-tight">
        {replyTo.sender_name}
      </p>
      <p className="text-[11px] text-muted-foreground/80 truncate leading-tight mt-0.5">
        {preview}
      </p>
    </button>
  );
}

// ─── Deleted Message Placeholder ────────────────────────────────────

function DeletedMessage() {
  return (
    <div className="flex justify-center py-1">
      <span className="text-[11px] text-muted-foreground/60 italic px-3 py-1 bg-muted/20 rounded-full">
        This message was deleted
      </span>
    </div>
  );
}

// ─── Message Actions (hover) ────────────────────────────────────────

function MessageActions({
  isOwn,
  onReply,
  onDelete,
  onReact,
}: {
  isOwn: boolean;
  onReply: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
}) {
  return (
    <div className="absolute -top-3 right-1 flex items-center gap-0.5 opacity-0 group-hover/message:opacity-100 transition-opacity z-10">
      <EmojiPicker onPick={onReact}>
        <Button
          variant="outline"
          size="icon"
          className="w-6 h-6 bg-background shadow-sm border rounded-full"
        >
          <Smile className="w-3 h-3" />
        </Button>
      </EmojiPicker>
      <Button
        variant="outline"
        size="icon"
        onClick={onReply}
        className="w-6 h-6 bg-background shadow-sm border rounded-full"
      >
        <Reply className="w-3 h-3" />
      </Button>
      {isOwn && (
        <Button
          variant="outline"
          size="icon"
          onClick={onDelete}
          className="w-6 h-6 bg-background shadow-sm border rounded-full text-destructive hover:text-destructive"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
}

// ─── Date Separator ─────────────────────────────────────────────────

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-2">
      <div className="bg-muted/60 text-[10px] text-muted-foreground font-medium px-3 py-1 rounded-full">
        {label}
      </div>
    </div>
  );
}

// ─── Message Bubble ─────────────────────────────────────────────────

function MessageBubble({
  msg,
  isOwn,
  onSetReplyTo,
  onDeleteMessage,
  onAddReaction,
  onScrollToMessage,
  onImagePreview,
  currentUserId,
}: {
  msg: ChatMessage;
  isOwn: boolean;
  onSetReplyTo: (replyTo: { id: string; senderName: string; content: string | null }) => void;
  onDeleteMessage?: (messageId: string) => void;
  onAddReaction?: (messageId: string, emoji: string) => void;
  onScrollToMessage: (id: string) => void;
  onImagePreview: (src: string, alt: string) => void;
  currentUserId: string;
}) {
  const timeStr = formatMessageTime(msg.created_at);
  const fullTime = formatFullTime(msg.created_at);

  // Deleted message
  if (msg.deleted === 1) {
    return <DeletedMessage />;
  }

  // System message
  if (msg.type === 'SYSTEM') {
    return (
      <div className="flex justify-center py-1">
        <span className="text-[10px] text-muted-foreground italic px-3 py-1 bg-muted/30 rounded-full">
          {msg.content}
        </span>
      </div>
    );
  }

  const handleReply = () => {
    onSetReplyTo({
      id: msg.id,
      senderName: msg.sender_name,
      content: msg.content,
    });
  };

  const handleDelete = () => {
    onDeleteMessage?.(msg.id);
  };

  const handleReact = (emoji: string) => {
    onAddReaction?.(msg.id, emoji);
  };

  const handleScrollToReply = () => {
    if (msg._replyTo) {
      onScrollToMessage(msg._replyTo.id);
    }
  };

  return (
    <div
      id={`msg-${msg.id}`}
      className={cn('flex gap-2 max-w-[80%] relative group/message', isOwn ? 'ml-auto flex-row-reverse' : 'mr-auto')}
    >
      {/* Hover action menu */}
      <MessageActions
        isOwn={isOwn}
        onReply={handleReply}
        onDelete={handleDelete}
        onReact={handleReact}
      />

      {/* Message bubble */}
      <div className={cn(
        'rounded-2xl px-3 py-2 text-sm',
        isOwn
          ? 'bg-primary text-primary-foreground rounded-br-sm'
          : 'bg-muted rounded-bl-sm'
      )}>
        {/* Sender name for group/admin view */}
        {!isOwn && (
          <p className={cn(
            'text-[10px] font-semibold mb-0.5',
            isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground'
          )}>
            {msg.sender_name}
          </p>
        )}

        {/* Relayed indicator */}
        {msg._relayed && (
          <div className={cn(
            'flex items-center gap-1 text-[9px] mb-1 px-1.5 py-0.5 rounded-full',
            isOwn ? 'bg-primary-foreground/10 text-primary-foreground' : 'bg-violet-100 text-violet-700'
          )}>
            <ArrowRight className="w-2.5 h-2.5" />
            <span>Relayed: {msg._relayedFrom} → {msg._relayedTo}</span>
          </div>
        )}

        {/* Reply-to quote */}
        {msg._replyTo && (
          <ReplyToQuote
            replyTo={msg._replyTo}
            senderRole={msg._replyTo.type === msg.sender_role ? msg.sender_role : msg.sender_role}
            onClick={handleScrollToReply}
          />
        )}

        {/* Message content */}
        {msg.type === 'FILE' ? (
          <FileMessage msg={msg} onImagePreview={onImagePreview} />
        ) : (
          <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
        )}

        {/* Reactions */}
        {msg._reactions && msg._reactions.length > 0 && (
          <ReactionsRow
            reactions={msg._reactions}
            currentUserId={currentUserId}
            onReaction={handleReact}
          />
        )}

        {/* Time + read receipt */}
        <div className={cn(
          'flex items-center gap-1 justify-end mt-0.5',
          isOwn ? 'text-primary-foreground/60' : 'text-muted-foreground'
        )}>
          <span className="text-[9px]" title={fullTime}>{timeStr}</span>
          {isOwn && (
            msg.status === 'READ' ? (
              <CheckCheck className="w-3 h-3" />
            ) : (
              <Check className="w-3 h-3" />
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main ChatWindow ────────────────────────────────────────────────

export function ChatWindow({
  currentUserId,
  replyTo,
  onSetReplyTo,
  onDeleteMessage,
  onAddReaction,
}: ChatWindowProps) {
  const { activeThread, messages, typingUsers, onlineUsers } = useChatContext();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  const otherParticipant = useMemo(() => {
    if (!activeThread) return null;
    return getOtherParticipant(activeThread, currentUserId);
  }, [activeThread, currentUserId]);

  const isOnline = useMemo(() => {
    if (!otherParticipant || !activeThread) return false;
    return onlineUsers.some(u => u.userId === otherParticipant.id);
  }, [otherParticipant, activeThread, onlineUsers]);

  const typingUser = useMemo(() => {
    if (!activeThread) return null;
    return typingUsers.get(activeThread.id) || null;
  }, [activeThread, typingUsers]);

  // Build message groups with date separators
  const messageGroups = useMemo(() => {
    if (messages.length === 0) return [];
    const groups: { date: string; messages: ChatMessage[] }[] = [];
    let currentDate = '';

    for (const msg of messages) {
      const msgDate = msg.created_at.split('T')[0]; // YYYY-MM-DD
      if (msgDate !== currentDate) {
        currentDate = msgDate;
        groups.push({ date: msg.created_at, messages: [] });
      }
      groups[groups.length - 1].messages.push(msg);
    }

    return groups;
  }, [messages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, typingUser]);

  // Scroll position tracking for FAB
  const handleScroll = useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    setShowScrollBtn(distanceFromBottom > 200);
  }, []);

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Try to get the scroll viewport ref from ScrollArea
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement;
      if (el) scrollViewportRef.current = el;
    }, 100);
    return () => clearTimeout(timer);
  }, [activeThread?.id]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const scrollToMessage = useCallback((id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Brief highlight
      el.classList.add('ring-2', 'ring-primary/30', 'rounded-2xl');
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-primary/30', 'rounded-2xl');
      }, 2000);
    }
  }, []);

  const handleImagePreview = useCallback((src: string, alt: string) => {
    setLightbox({ src, alt });
  }, []);

  const handleCloseLightbox = useCallback(() => {
    setLightbox(null);
  }, []);

  if (!activeThread) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
          <svg className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
        </div>
        <h3 className="text-sm font-medium">Select a conversation</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Choose a thread from the list to start chatting.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b shrink-0">
        <div className="relative">
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
            <span className="text-xs font-semibold text-muted-foreground">
              {otherParticipant?.name.charAt(0)?.toUpperCase()}
            </span>
          </div>
          {isOnline && (
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-background" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate">{otherParticipant?.name}</span>
            {otherParticipant && (
              <Badge
                variant="outline"
                className={cn('text-[9px] px-1 py-0 h-4', ROLE_STYLES[otherParticipant.role] || '')}
              >
                {otherParticipant.role}
              </Badge>
            )}
            {activeThread.type === 'RELAYED' && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-violet-100 text-violet-700 border-violet-200">
                RELAYED
              </Badge>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {isOnline ? (
              <span className="text-emerald-600">Online</span>
            ) : (
              'Offline'
            )}
            {activeThread.case_id && (
              <span className="ml-2 text-muted-foreground">Case: {activeThread.case_id.slice(0, 8)}</span>
            )}
          </p>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4" ref={scrollRef}>
        <div className="py-3 space-y-2">
          {messages.length === 0 ? (
            <div className="flex justify-center py-8">
              <span className="text-xs text-muted-foreground">
                No messages yet. Send a message to start the conversation.
              </span>
            </div>
          ) : (
            messageGroups.map((group, gi) => (
              <React.Fragment key={group.date}>
                {/* Date separator */}
                <DateSeparator label={formatDateSeparator(group.date)} />
                {/* Messages in this date group */}
                {group.messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    isOwn={msg.sender_id === currentUserId}
                    onSetReplyTo={onSetReplyTo}
                    onDeleteMessage={onDeleteMessage}
                    onAddReaction={onAddReaction}
                    onScrollToMessage={scrollToMessage}
                    onImagePreview={handleImagePreview}
                    currentUserId={currentUserId}
                  />
                ))}
              </React.Fragment>
            ))
          )}

          {/* Typing indicator */}
          {typingUser && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground italic">{typingUser} is typing...</span>
              <div className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Scroll to bottom FAB */}
      {showScrollBtn && (
        <Button
          size="icon"
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 w-9 h-9 rounded-full shadow-lg z-10"
        >
          <ArrowDown className="w-4 h-4" />
        </Button>
      )}

      {/* Image Lightbox */}
      {lightbox && (
        <ImageLightbox
          open={!!lightbox}
          onOpenChange={(open) => { if (!open) handleCloseLightbox(); }}
          src={lightbox.src}
          alt={lightbox.alt}
        />
      )}
    </div>
  );
}
