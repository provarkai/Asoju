'use client';

import React, { useMemo, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useChatContext } from './chat-provider';
import { MessageCircle, Search, Paperclip, Reply } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  type ChatThread,
  getUnreadCount,
  getOtherParticipant,
  formatMessageTime,
} from './types';

interface ChatListProps {
  onSelectThread: (thread: ChatThread) => void;
  currentUserId: string;
  filterType?: 'ALL' | 'DIRECT' | 'RELAYED';
}

const ROLE_STYLES: Record<string, string> = {
  AGENT: 'bg-amber-100 text-amber-800 border-amber-200',
  ADMIN: 'bg-slate-100 text-slate-700 border-slate-200',
  CUSTOMER: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

function ThreadItem({
  thread,
  currentUserId,
  isActive,
  onlineUsers,
  onClick,
}: {
  thread: ChatThread;
  currentUserId: string;
  isActive: boolean;
  onlineUsers: Set<string>;
  onClick: () => void;
}) {
  const other = getOtherParticipant(thread, currentUserId);
  if (!other) return null;

  const unread = getUnreadCount(thread, currentUserId);
  const isOnline = onlineUsers.has(other.id);
  const timeStr = formatMessageTime(thread.last_message_at);
  const isFile = thread.last_message_type === 'FILE';
  const isReply = thread.last_message_is_reply === 1;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors border-b border-border/50',
        isActive
          ? 'bg-primary/5 border-l-2 border-l-primary'
          : 'hover:bg-muted/50'
      )}
    >
      {/* Avatar with online indicator */}
      <div className="relative shrink-0">
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
          <span className="text-sm font-semibold text-muted-foreground">
            {other.name.charAt(0)?.toUpperCase()}
          </span>
        </div>
        {isOnline && (
          <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-background" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-medium truncate">{other.name}</span>
            <Badge
              variant="outline"
              className={cn('text-[9px] px-1 py-0 h-4 shrink-0', ROLE_STYLES[other.role] || '')}
            >
              {other.role.charAt(0)}
            </Badge>
            {thread.type === 'RELAYED' && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 shrink-0 bg-violet-100 text-violet-700 border-violet-200">
                R
              </Badge>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0">{timeStr}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {/* Reply indicator */}
          {isReply && (
            <Reply className="w-3 h-3 text-muted-foreground/60 shrink-0" />
          )}
          <p className="text-xs text-muted-foreground truncate flex-1">
            {isFile ? (
              <span className="flex items-center gap-1">
                <Paperclip className="w-3 h-3 shrink-0" />
                {thread.last_message || 'Sent a file'}
              </span>
            ) : (
              thread.last_message || 'No messages yet'
            )}
          </p>
          {unread > 0 && (
            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export function ChatList({ onSelectThread, currentUserId, filterType = 'ALL' }: ChatListProps) {
  const { threads, activeThread, onlineUsers, isConnected } = useChatContext();
  const [search, setSearch] = useState('');

  const onlineUserIds = useMemo(
    () => new Set<string>(onlineUsers.map(u => u.userId)),
    [onlineUsers]
  );

  const filteredThreads = useMemo(() => {
    let result = threads;

    if (filterType !== 'ALL') {
      result = result.filter(t => t.type === filterType);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(t =>
        t.participant_a_name.toLowerCase().includes(q) ||
        t.participant_b_name.toLowerCase().includes(q) ||
        (t.last_message || '').toLowerCase().includes(q)
      );
    }

    return result.sort((a, b) => {
      const timeA = a.last_message_at ? new Date(a.last_message_at).getTime() : new Date(a.created_at).getTime();
      const timeB = b.last_message_at ? new Date(b.last_message_at).getTime() : new Date(b.created_at).getTime();
      return timeB - timeA;
    });
  }, [threads, filterType, search]);

  const totalUnread = useMemo(
    () => threads.reduce((sum, t) => sum + getUnreadCount(t, currentUserId), 0),
    [threads, currentUserId]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Messages</h2>
            {totalUnread > 0 && (
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </div>
          <div className={cn(
            'w-2 h-2 rounded-full',
            isConnected ? 'bg-emerald-500' : 'bg-red-400'
          )} />
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* Thread list */}
      <ScrollArea className="flex-1">
        {filteredThreads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-3">
              <MessageCircle className="w-7 h-7 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium">No conversations yet</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Start a new conversation from a case or profile.
            </p>
          </div>
        ) : (
          filteredThreads.map(thread => (
            <ThreadItem
              key={thread.id}
              thread={thread}
              currentUserId={currentUserId}
              isActive={activeThread?.id === thread.id}
              onlineUsers={onlineUserIds}
              onClick={() => onSelectThread(thread)}
            />
          ))
        )}
      </ScrollArea>
    </div>
  );
}
