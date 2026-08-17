'use client';

import { createContext, useContext, ReactNode } from 'react';
import { useChat, type UseChatReturn } from '@/hooks/use-chat';

export type ChatContextType = UseChatReturn;

const ChatContext = createContext<ChatContextType | null>(null);

export function ChatProvider({ children, user, enabled = true }: {
  children: ReactNode;
  user: { userId: string; role: string; displayName: string } | null;
  enabled?: boolean;
}) {
  const chat = useChat({ user: user as any, enabled });

  return (
    <ChatContext.Provider value={chat}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider');
  return ctx;
}
