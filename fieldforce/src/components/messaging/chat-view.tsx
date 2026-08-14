'use client';

import { useState, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { useChatContext } from './chat-provider';
import { ChatList } from './chat-list';
import { ChatWindow } from './chat-window';
import { ChatInput } from './chat-input';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChatMessage } from './types';

type ReplyToInfo = { id: string; senderName: string; content: string | null } | null;

export default function ChatView() {
  const agent = useAppStore(s => s.agent);
  const { activeThread, setActiveThread, sendMessage } = useChatContext();
  const [showChat, setShowChat] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyToInfo>(null);

  const currentUserId = agent?.id || '';
  const currentUserRole = 'AGENT';

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
    // Send as a normal message with the reply-to context
    // The BFF/socket will handle the reply_to_id
    sendMessage(activeThread.id, content);
  }, [activeThread, sendMessage]);

  const handleDeleteMessage = useCallback((_messageId: string) => {
    // Placeholder: would call a deleteMessage from context when implemented
  }, []);

  const handleAddReaction = useCallback((_messageId: string, _emoji: string) => {
    // Placeholder: would call an addReaction from context when implemented
  }, []);

  if (showChat && activeThread) {
    return (
      <div className="flex flex-col h-[calc(100vh-7rem)]">
        {/* Back header */}
        <div className="flex items-center gap-2 px-2 py-1 border-b shrink-0">
          <Button variant="ghost" size="icon" className="w-8 h-8" onClick={handleBack}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </div>
        {/* Chat window */}
        <ChatWindow
          currentUserId={currentUserId}
          replyTo={replyTo}
          onSetReplyTo={setReplyTo}
          onDeleteMessage={handleDeleteMessage}
          onAddReaction={handleAddReaction}
        />
        {/* Input */}
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
    <div className="h-[calc(100vh-7rem)]">
      <ChatList
        onSelectThread={handleSelectThread}
        currentUserId={currentUserId}
      />
    </div>
  );
}
