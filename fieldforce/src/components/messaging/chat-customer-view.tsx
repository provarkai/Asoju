'use client';

import { useState, useCallback } from 'react';
import { useCustomerContext } from '@/components/customer/customer-shell';
import { useChatContext } from './chat-provider';
import { ChatList } from './chat-list';
import { ChatWindow } from './chat-window';
import { ChatInput } from './chat-input';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ReplyToInfo = { id: string; senderName: string; content: string | null } | null;

export default function ChatCustomerView() {
  const { profile } = useCustomerContext();
  const { activeThread, setActiveThread, sendMessage } = useChatContext();
  const [showChat, setShowChat] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyToInfo>(null);

  const currentUserId = profile?.member?.id || '';
  const currentUserRole = 'CUSTOMER';

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

  if (showChat && activeThread) {
    return (
      <div className="flex flex-col h-[calc(100vh-12rem)]">
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
    );
  }

  return (
    <div className="h-[calc(100vh-12rem)]">
      <ChatList
        onSelectThread={handleSelectThread}
        currentUserId={currentUserId}
      />
    </div>
  );
}
