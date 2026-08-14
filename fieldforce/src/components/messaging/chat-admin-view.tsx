'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useChatContext } from './chat-provider';
import { ChatList } from './chat-list';
import { ChatWindow } from './chat-window';
import { ChatInput } from './chat-input';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const FILTER_LABELS: Record<string, string> = {
  ALL: 'All',
  DIRECT: 'Direct',
  RELAYED: 'Supervised',
};

type ReplyToInfo = { id: string; senderName: string; content: string | null } | null;

interface ChatAdminViewProps {
  adminId: string;
}

export default function ChatAdminView({ adminId }: ChatAdminViewProps) {
  const { activeThread, setActiveThread, threads, sendMessage } = useChatContext();
  const [showChat, setShowChat] = useState(false);
  const [filterType, setFilterType] = useState<'ALL' | 'DIRECT' | 'RELAYED'>('ALL');
  const [replyTo, setReplyTo] = useState<ReplyToInfo>(null);

  const currentUserId = adminId;
  const currentUserRole = 'ADMIN';

  const handleSelectThread = useCallback((thread: typeof activeThread) => {
    if (thread) {
      setActiveThread(thread);
      setReplyTo(null);
      setShowChat(true);
    }
  }, [setActiveThread]);

  const handleBack = useCallback(() => {
    setShowChat(false);
    setActiveThread(null);
    setReplyTo(null);
  }, [setActiveThread]);

  const totalUnread = useMemo(
    () => threads.reduce((sum, t) => {
      if (t.participant_a_id === adminId) return sum + t.unread_count_a;
      if (t.participant_b_id === adminId) return sum + t.unread_count_b;
      return sum;
    }, 0),
    [threads, adminId]
  );

  const handleCancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  const handleSendReply = useCallback((replyToId: string, content: string) => {
    if (!activeThread) return;
    sendMessage(activeThread.id, content);
  }, [activeThread, sendMessage]);

  const handleDeleteMessage = useCallback((_messageId: string) => {
    // Placeholder
  }, []);

  const handleAddReaction = useCallback((_messageId: string, _emoji: string) => {
    // Placeholder
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Desktop layout */}
      <div className="hidden lg:flex flex-1 overflow-hidden border rounded-lg">
        {/* Left: Thread list */}
        <div className="w-80 border-r flex flex-col shrink-0">
          {/* Filter tabs */}
          <div className="flex items-center gap-1 px-4 py-2 border-b">
            {(['ALL', 'DIRECT', 'RELAYED'] as const).map(ft => (
              <button
                key={ft}
                onClick={() => setFilterType(ft)}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-full font-medium transition-colors',
                  filterType === ft
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                )}
              >
                {FILTER_LABELS[ft]}
              </button>
            ))}
          </div>
          <ChatList
            onSelectThread={handleSelectThread}
            currentUserId={currentUserId}
            filterType={filterType}
          />
        </div>

        {/* Right: Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {activeThread ? (
            <>
              <ChatWindow
                currentUserId={currentUserId}
                replyTo={replyTo}
                onSetReplyTo={setReplyTo}
                onDeleteMessage={handleDeleteMessage}
                onAddReaction={handleAddReaction}
              />
              <ChatInput
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                threadType={activeThread.type}
                replyTo={replyTo}
                onCancelReply={handleCancelReply}
                onSendReply={handleSendReply}
              />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
                <svg className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
                </svg>
              </div>
              <div className="flex items-center justify-center gap-2 mb-1">
                <h3 className="text-sm font-medium">Admin Messaging</h3>
                {totalUnread > 0 && (
                  <Badge className="text-[10px] px-1.5 py-0 h-5">
                    {totalUnread > 99 ? '99+' : totalUnread}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Select a conversation from the list to view and send messages. You can monitor all agent-customer relayed messages.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Mobile layout */}
      <div className="lg:hidden flex flex-1 overflow-hidden">
        {showChat && activeThread ? (
          <div className="flex flex-col w-full">
            <div className="flex items-center gap-2 px-2 py-1 border-b shrink-0">
              <Button variant="ghost" size="icon" className="w-8 h-8" onClick={handleBack}>
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </div>
            <ChatWindow
              currentUserId={currentUserId}
              replyTo={replyTo}
              onSetReplyTo={setReplyTo}
              onDeleteMessage={handleDeleteMessage}
              onAddReaction={handleAddReaction}
            />
            <ChatInput
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              threadType={activeThread.type}
              replyTo={replyTo}
              onCancelReply={handleCancelReply}
              onSendReply={handleSendReply}
            />
          </div>
        ) : (
          <ChatList
            onSelectThread={handleSelectThread}
            currentUserId={currentUserId}
          />
        )}
      </div>
    </div>
  );
}
