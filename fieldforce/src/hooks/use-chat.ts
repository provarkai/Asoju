'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getAuthToken, authFetch } from '@/lib/auth-fetch';
import type { ChatThread, ChatMessage, ChatReaction, OnlineUser, ChatUser } from '@/components/messaging/types';

interface UseChatOptions {
  user: ChatUser | null;
  enabled?: boolean;
}

export interface UseChatReturn {
  isConnected: boolean;
  threads: ChatThread[];
  activeThread: ChatThread | null;
  messages: ChatMessage[];
  onlineUsers: OnlineUser[];
  typingUsers: Map<string, string>;
  connect: () => void;
  disconnect: () => void;
  setActiveThread: (thread: ChatThread | null) => void;
  loadThreads: () => Promise<void>;
  loadMessages: (threadId: string, before?: string) => Promise<void>;
  sendMessage: (threadId: string, content: string, type?: 'TEXT', replyToId?: string) => void;
  sendFileMessage: (threadId: string, fileUrl: string, fileName: string, fileSize: number, fileType: string) => void;
  markAsRead: (threadId: string) => void;
  startTyping: (threadId: string) => void;
  stopTyping: (threadId: string) => void;
  createThread: (participantB: { id: string; role: string; name: string }, caseId?: string) => Promise<ChatThread>;
  uploadFile: (file: File) => Promise<{ url: string; fileName: string; fileSize: number; fileType: string }>;
  deleteMessage: (threadId: string, messageId: string) => void;
  addReaction: (threadId: string, messageId: string, emoji: string) => void;
  removeReaction: (threadId: string, messageId: string, emoji: string) => void;
  error: string | null;
}

function getChatToken(role: string): string | null {
  if (typeof window === 'undefined') return null;
  switch (role) {
    case 'ADMIN': return getAuthToken('admin');
    case 'AGENT': return getAuthToken('agent');
    case 'CUSTOMER': return getAuthToken('customer');
    default: return null;
  }
}

export function useChat({ user, enabled = true }: UseChatOptions): UseChatReturn {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThread, setActiveThread] = useState<ChatThread | null>(null);
  const [messagesMap, setMessagesMap] = useState<Map<string, ChatMessage[]>>(new Map());
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const typingTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Compute active messages based on active thread
  const messages = activeThread ? (messagesMap.get(activeThread.id) || []) : [];

  // Load threads (defined early to avoid access-before-declare)
  const loadThreadsInternal = useCallback(async () => {
    try {
      const res = await authFetch('/api/chat/threads');
      if (res.ok) {
        const data = await res.json();
        setThreads(data.threads || []);
      }
    } catch (err) {
      console.error('[Chat] Failed to load threads:', err);
    }
  }, []);

  const connect = useCallback(() => {
    if (!user) return;
    // Prevent duplicate connections — disconnect existing first
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    const token = getChatToken(user.role);
    if (!token) {
      setError('No auth token found. Please log in again.');
      return;
    }

    setError(null);

    const socket = io('/', {
      transports: ['polling'],
      auth: { token },
      query: { XTransformPort: String(3005) },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => {
      console.log('[Chat] Socket connected');
      setIsConnected(true);
      setError(null);
      // Load threads on connect
      loadThreadsInternal();
    });

    socket.on('disconnect', (reason) => {
      console.log('[Chat] Socket disconnected:', reason);
      setIsConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.error('[Chat] Connection error:', err.message);
      setError(err.message);
      setIsConnected(false);
    });

    // New message
    socket.on('message:new', (msg: ChatMessage) => {
      setMessagesMap(prev => {
        const next = new Map(prev);
        const existing = next.get(msg.thread_id) || [];
        // Avoid duplicates
        if (!existing.find(m => m.id === msg.id)) {
          next.set(msg.thread_id, [...existing, msg]);
        }
        return next;
      });
    });

    // Message status update (SENT → DELIVERED → READ)
    socket.on('message:status', (data: { threadId: string; messageIds: string[]; status: string }) => {
      setMessagesMap(prev => {
        const next = new Map(prev);
        const threadMsgs = next.get(data.threadId);
        if (!threadMsgs) return prev;
        next.set(data.threadId,
          threadMsgs.map(m =>
            data.messageIds.includes(m.id)
              ? { ...m, status: data.status as ChatMessage['status'] }
              : m
          )
        );
        return next;
      });
    });

    // Message deleted
    socket.on('message:deleted', (data: { threadId: string; messageId: string; deletedBy: string }) => {
      setMessagesMap(prev => {
        const next = new Map(prev);
        const threadMsgs = next.get(data.threadId);
        if (!threadMsgs) return prev;
        next.set(data.threadId,
          threadMsgs.map(m =>
            m.id === data.messageId
              ? { ...m, deleted: 1, content: null, file_url: null }
              : m
          )
        );
        return next;
      });
    });

    // Reaction added
    socket.on('reaction:added', (data: { threadId: string; reaction: ChatReaction }) => {
      setMessagesMap(prev => {
        const next = new Map(prev);
        const threadMsgs = next.get(data.threadId);
        if (!threadMsgs) return prev;
        next.set(data.threadId,
          threadMsgs.map(m => {
            if (m.id !== data.reaction.message_id) return m;
            const reactions = [...(m._reactions || [])];
            // Avoid duplicate
            if (!reactions.find(r => r.id === data.reaction.id)) {
              reactions.push(data.reaction);
            }
            return { ...m, _reactions: reactions };
          })
        );
        return next;
      });
    });

    // Reaction removed
    socket.on('reaction:removed', (data: { threadId: string; messageId: string; userId: string; emoji: string }) => {
      setMessagesMap(prev => {
        const next = new Map(prev);
        const threadMsgs = next.get(data.threadId);
        if (!threadMsgs) return prev;
        next.set(data.threadId,
          threadMsgs.map(m => {
            if (m.id !== data.messageId) return m;
            const reactions = (m._reactions || []).filter(
              r => !(r.user_id === data.userId && r.emoji === data.emoji)
            );
            return { ...m, _reactions: reactions };
          })
        );
        return next;
      });
    });

    // Thread updated
    socket.on('thread:updated', (thread: ChatThread) => {
      setThreads(prev => {
        const idx = prev.findIndex(t => t.id === thread.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = thread;
          return next;
        }
        return [thread, ...prev];
      });
      // Update active thread if it matches
      setActiveThread(prev => {
        if (prev?.id === thread.id) return thread;
        return prev;
      });
    });

    // Typing indicators
    socket.on('user:typing', (data: { threadId: string; userId: string; userName: string; isTyping?: boolean }) => {
      if (data.isTyping === false) {
        setTypingUsers(prev => {
          const next = new Map(prev);
          next.delete(data.threadId);
          return next;
        });
      } else {
        setTypingUsers(prev => {
          const next = new Map(prev);
          next.set(data.threadId, data.userName);
          return next;
        });
        // Auto-clear after 3s
        const existingTimeout = typingTimeoutRef.current.get(data.threadId);
        if (existingTimeout) clearTimeout(existingTimeout);
        typingTimeoutRef.current.set(data.threadId, setTimeout(() => {
          setTypingUsers(prev => {
            const next = new Map(prev);
            next.delete(data.threadId);
            return next;
          });
          typingTimeoutRef.current.delete(data.threadId);
        }, 3000));
      }
    });

    // Presence
    socket.on('user:online', (data: { userId: string; userName: string; role: string }) => {
      setOnlineUsers(prev => {
        if (!prev.find(u => u.userId === data.userId)) {
          return [...prev, { ...data, status: 'online' as const }];
        }
        return prev.map(u => u.userId === data.userId ? { ...u, status: 'online' as const } : u);
      });
    });

    socket.on('user:offline', (data: { userId: string }) => {
      setOnlineUsers(prev => prev.filter(u => u.userId !== data.userId));
    });

    socket.on('presence:list', (data: { users: OnlineUser[] }) => {
      setOnlineUsers(data.users);
    });

    socket.on('error', (data: { code: string; message: string }) => {
      console.error('[Chat] Socket error:', data);
      setError(data.message);
    });

    socketRef.current = socket;
  }, [user, loadThreadsInternal]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    }
  }, []);

  // Load messages for a thread
  const loadMessages = useCallback(async (threadId: string, before?: string) => {
    try {
      let url = `/api/chat/threads/${threadId}/messages`;
      if (before) url += `?before=${before}`;
      const res = await authFetch(url);
      if (res.ok) {
        const data = await res.json();
        setMessagesMap(prev => {
          const next = new Map(prev);
          next.set(threadId, data.messages || []);
          return next;
        });
      }
    } catch (err) {
      console.error('[Chat] Failed to load messages:', err);
    }
  }, []);

  // Send a text message via Socket.IO (with optional reply-to)
  const sendMessage = useCallback((threadId: string, content: string, type: 'TEXT' = 'TEXT', replyToId?: string) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;

    // Join thread room first
    socket.emit('thread:join', { threadId }, (resp: { success: boolean }) => {
      if (resp?.success) {
        socket.emit('message:send', { threadId, content, type, replyToId: replyToId || undefined });
      }
    });
  }, []);

  // Send a file message via Socket.IO
  const sendFileMessage = useCallback((threadId: string, fileUrl: string, fileName: string, fileSize: number, fileType: string) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;

    socket.emit('thread:join', { threadId }, (resp: { success: boolean }) => {
      if (resp?.success) {
        socket.emit('message:send', {
          threadId,
          type: 'FILE',
          fileUrl,
          fileName,
          fileSize,
          fileType,
        });
      }
    });
  }, []);

  // Mark thread as read
  const markAsRead = useCallback((threadId: string) => {
    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit('message:read', { threadId });
    }
    // Also call REST endpoint as backup
    authFetch(`/api/chat/threads/${threadId}/read`, { method: 'POST' }).catch(() => {});
  }, []);

  // Typing indicators
  const startTyping = useCallback((threadId: string) => {
    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit('typing:start', { threadId });
    }
  }, []);

  const stopTyping = useCallback((threadId: string) => {
    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit('typing:stop', { threadId });
    }
  }, []);

  // Delete a message (soft delete)
  const deleteMessage = useCallback((threadId: string, messageId: string) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;

    socket.emit('thread:join', { threadId }, (resp: { success: boolean }) => {
      if (resp?.success) {
        socket.emit('message:delete', { threadId, messageId });
      }
    });
  }, []);

  // Add a reaction to a message
  const addReaction = useCallback((threadId: string, messageId: string, emoji: string) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;

    socket.emit('thread:join', { threadId }, (resp: { success: boolean }) => {
      if (resp?.success) {
        socket.emit('reaction:add', { threadId, messageId, emoji });
      }
    });
  }, []);

  // Remove a reaction from a message
  const removeReaction = useCallback((threadId: string, messageId: string, emoji: string) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;

    socket.emit('thread:join', { threadId }, (resp: { success: boolean }) => {
      if (resp?.success) {
        socket.emit('reaction:remove', { threadId, messageId, emoji });
      }
    });
  }, []);

  // Create a new thread
  const createThread = useCallback(async (participantB: { id: string; role: string; name: string }, caseId?: string): Promise<ChatThread> => {
    const res = await authFetch('/api/chat/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantBId: participantB.id,
        participantBRole: participantB.role,
        participantBName: participantB.name,
        caseId: caseId || null,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create thread');
    }

    const data = await res.json();
    const thread = data.thread as ChatThread;
    setThreads(prev => [thread, ...prev]);
    return thread;
  }, []);

  // Upload a file (through BFF)
  const uploadFile = useCallback(async (file: File): Promise<{ url: string; fileName: string; fileSize: number; fileType: string }> => {
    const token = user ? getChatToken(user.role) : null;
    const formData = new FormData();
    formData.append('file', file);

    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/api/chat/upload', {
      method: 'POST',
      body: formData,
      headers,
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'File upload failed');
    }

    return res.json();
  }, [user]);

  // Load threads (public API)
  const loadThreads = useCallback(async () => {
    await loadThreadsInternal();
  }, [loadThreadsInternal]);

  // Auto-connect when enabled and user is available
  useEffect(() => {
    if (!enabled || !user) return;
    const timer = setTimeout(() => connect(), 500);
    return () => {
      clearTimeout(timer);
      // Clean up socket on unmount
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [enabled, user, connect]);

  // Load messages when active thread changes
  useEffect(() => {
    if (!activeThread || !isConnected) return;
    const timer = setTimeout(() => {
      loadMessages(activeThread.id);
      // Mark as read
      markAsRead(activeThread.id);
      // Join thread room
      const socket = socketRef.current;
      if (socket?.connected) {
        socket.emit('thread:join', { threadId: activeThread.id });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [activeThread?.id, isConnected, loadMessages, markAsRead]);

  return {
    isConnected,
    threads,
    activeThread,
    messages,
    onlineUsers,
    typingUsers,
    connect,
    disconnect,
    setActiveThread,
    loadThreads,
    loadMessages,
    sendMessage,
    sendFileMessage,
    markAsRead,
    startTyping,
    stopTyping,
    createThread,
    uploadFile,
    deleteMessage,
    addReaction,
    removeReaction,
    error,
  };
}
