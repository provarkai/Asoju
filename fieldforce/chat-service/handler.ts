import { Server, Socket } from 'socket.io';
import {
  getThreadById,
  addMessage,
  getMessages,
  markAsRead,
  updateMessageStatus,
  getMessageById,
  softDeleteMessage,
  addReaction,
  removeReaction,
  getReactionsForMessages,
  type Message,
  type Thread,
} from './db.js';

export interface OnlineUser {
  userId: string;
  userName: string;
  role: string;
  status: 'online' | 'away' | 'busy';
  socketId: string;
  threadIds: Set<string>;
}

// Socket ID → OnlineUser map
export const onlineUsers = new Map<string, OnlineUser>();

// Helper: find all sockets for a given user ID
function getSocketsForUser(io: Server, userId: string): Socket[] {
  const sockets: Socket[] = [];
  for (const [socketId, user] of onlineUsers) {
    if (user.userId === userId) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) sockets.push(socket);
    }
  }
  return sockets;
}

// Helper: get all online admin sockets
function getOnlineAdminSockets(io: Server): Socket[] {
  const sockets: Socket[] = [];
  for (const [socketId, user] of onlineUsers) {
    if (user.role === 'ADMIN') {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) sockets.push(socket);
    }
  }
  return sockets;
}

// Helper: broadcast presence list to all connected sockets
function broadcastPresenceList(io: Server): void {
  const users = Array.from(onlineUsers.values()).map(u => ({
    userId: u.userId,
    userName: u.userName,
    role: u.role,
    status: u.status,
  }));
  io.emit('presence:list', { users });
}

// Helper: determine the recipient of a message in a thread
function getRecipient(thread: Thread, senderId: string): { id: string; role: string; name: string } | null {
  if (thread.participant_a_id === senderId) {
    return {
      id: thread.participant_b_id,
      role: thread.participant_b_role,
      name: thread.participant_b_name,
    };
  } else if (thread.participant_b_id === senderId) {
    return {
      id: thread.participant_a_id,
      role: thread.participant_a_role,
      name: thread.participant_a_name,
    };
  }
  return null;
}

// Routing decision types
enum RouteDecision {
  ALLOWED,   // Deliver directly
  BLOCKED,   // Reject
  RELAYED,   // Deliver + notify admins
}

function decideRouting(senderRole: string, recipientRole: string, messageType: string): RouteDecision {
  const s = senderRole;
  const r = recipientRole;

  // Agent ↔ Customer routing rules
  if ((s === 'AGENT' && r === 'CUSTOMER') || (s === 'CUSTOMER' && r === 'AGENT')) {
    if (messageType === 'TEXT') {
      return RouteDecision.BLOCKED;
    }
    // FILE, LOCATION, etc. are relayed
    return RouteDecision.RELAYED;
  }

  // Agent ↔ Agent: blocked
  if (s === 'AGENT' && r === 'AGENT') {
    return RouteDecision.BLOCKED;
  }

  // Customer ↔ Customer: blocked
  if (s === 'CUSTOMER' && r === 'CUSTOMER') {
    return RouteDecision.BLOCKED;
  }

  // Admin ↔ Agent and Admin ↔ Customer: allowed
  if (s === 'ADMIN' || r === 'ADMIN') {
    return RouteDecision.ALLOWED;
  }

  // Default: blocked
  return RouteDecision.BLOCKED;
}

export function registerHandlers(io: Server): void {

  // ====== AUTH MIDDLEWARE ======
  io.use(async (socket, next) => {
    try {
      const { verifyToken } = await import('./auth.js');
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error('Authentication required: provide token in handshake.auth.token'));
      }

      const user = await verifyToken(token);
      // Store user info on the socket
      (socket as any).user = user;
      next();
    } catch (err: any) {
      console.error(`[AUTH] Socket ${socket.id} auth failed:`, err.message);
      next(new Error(err.message || 'Authentication failed'));
    }
  });

  // ====== CONNECTION ======
  io.on('connection', (socket) => {
    const user = (socket as any).user as { userId: string; role: string; displayName: string };

    console.log(`[SOCKET] Connected: ${socket.id} | ${user.role} ${user.displayName} (${user.userId})`);

    // Register online user
    const onlineUser: OnlineUser = {
      userId: user.userId,
      userName: user.displayName,
      role: user.role,
      status: 'online',
      socketId: socket.id,
      threadIds: new Set(),
    };
    onlineUsers.set(socket.id, onlineUser);

    // Broadcast user online
    socket.broadcast.emit('user:online', {
      userId: user.userId,
      userName: user.displayName,
      role: user.role,
    });
    broadcastPresenceList(io);

    // ====== AUTH EVENT (re-authenticate) ======
    socket.on('auth', async (data: { token: string }, callback?: (response: any) => void) => {
      try {
        const { verifyToken } = await import('./auth.js');
        const verifiedUser = await verifyToken(data.token);
        (socket as any).user = verifiedUser;

        // Update online user record
        onlineUsers.set(socket.id, {
          userId: verifiedUser.userId,
          userName: verifiedUser.displayName,
          role: verifiedUser.role,
          status: 'online',
          socketId: socket.id,
          threadIds: onlineUsers.get(socket.id)?.threadIds || new Set(),
        });

        console.log(`[AUTH] Socket ${socket.id} re-authenticated as ${verifiedUser.role} ${verifiedUser.displayName}`);
        callback?.({ success: true, user: verifiedUser });
      } catch (err: any) {
        callback?.({ success: false, error: err.message });
      }
    });

    // ====== THREAD:JOIN ======
    socket.on('thread:join', (data: { threadId: string }, callback?: (response: any) => void) => {
      const { threadId } = data;
      const thread = getThreadById(threadId);

      if (!thread) {
        socket.emit('error', { code: 'THREAD_NOT_FOUND', message: `Thread ${threadId} not found` });
        callback?.({ success: false, error: 'Thread not found' });
        return;
      }

      // Verify user is a participant
      const isParticipant =
        (thread.participant_a_id === user.userId && thread.participant_a_role === user.role) ||
        (thread.participant_b_id === user.userId && thread.participant_b_role === user.role);

      if (!isParticipant) {
        socket.emit('error', { code: 'FORBIDDEN', message: 'You are not a participant in this thread' });
        callback?.({ success: false, error: 'Not a participant' });
        return;
      }

      socket.join(threadId);
      const ou = onlineUsers.get(socket.id);
      if (ou) ou.threadIds.add(threadId);

      // Auto-mark messages as DELIVERED when recipient joins the thread
      const recipient = getRecipient(thread, user.userId);
      if (recipient) {
        // Find unread SENT messages in this thread addressed to this user
        const unreadMessages = getMessages(threadId, { limit: 200 });
        const sentMessageIds = unreadMessages
          .filter(m => m.sender_id !== user.userId && m.status === 'SENT')
          .map(m => m.id);

        if (sentMessageIds.length > 0) {
          updateMessageStatus(sentMessageIds, 'DELIVERED');

          // Notify the senders that their messages were delivered
          const senderIds = new Set(sentMessageIds.map(id => {
            const msg = unreadMessages.find(m => m.id === id);
            return msg?.sender_id;
          }).filter(Boolean) as string[]);

          for (const senderId of senderIds) {
            const senderSockets = getSocketsForUser(io, senderId);
            for (const ss of senderSockets) {
              const idsForThisSender = unreadMessages
                .filter(m => m.sender_id === senderId && sentMessageIds.includes(m.id))
                .map(m => m.id);
              ss.emit('message:status', {
                threadId,
                messageIds: idsForThisSender,
                status: 'DELIVERED',
              });
            }
          }
        }
      }

      console.log(`[THREAD] ${user.displayName} joined thread ${threadId}`);
      callback?.({ success: true });
    });

    // ====== MESSAGE:SEND ======
    socket.on('message:send', async (data: {
      threadId: string;
      content?: string;
      type: 'TEXT' | 'FILE' | 'LOCATION';
      fileUrl?: string;
      fileName?: string;
      fileSize?: number;
      fileType?: string;
      replyToId?: string;
    }, callback?: (response: any) => void) => {
      const { threadId, content, type, fileUrl, fileName, fileSize, fileType, replyToId } = data;

      // 1. Look up thread
      const thread = getThreadById(threadId);
      if (!thread) {
        socket.emit('error', { code: 'THREAD_NOT_FOUND', message: 'Thread not found' });
        callback?.({ success: false, error: 'Thread not found' });
        return;
      }

      // 2. Verify sender is a participant
      const recipient = getRecipient(thread, user.userId);
      if (!recipient) {
        socket.emit('error', { code: 'FORBIDDEN', message: 'You are not a participant in this thread' });
        callback?.({ success: false, error: 'Not a participant' });
        return;
      }

      // 3. Validate replyToId if provided
      if (replyToId) {
        const repliedMsg = getMessageById(replyToId);
        if (!repliedMsg || repliedMsg.thread_id !== threadId) {
          socket.emit('error', { code: 'INVALID_REPLY', message: 'Replied message not found in this thread' });
          callback?.({ success: false, error: 'Invalid reply target' });
          return;
        }
      }

      // 4. Apply routing rules
      const decision = decideRouting(user.role, recipient.role, type);

      console.log(`[ROUTE] ${user.role}→${recipient.role} | type=${type} | decision=${RouteDecision[decision]} | thread=${threadId}`);

      if (decision === RouteDecision.BLOCKED) {
        const errorMsg = (user.role === 'AGENT' && recipient.role === 'CUSTOMER') ||
          (user.role === 'CUSTOMER' && recipient.role === 'AGENT')
          ? 'Direct text chat between agents and customers is not allowed'
          : `Direct messaging between ${user.role.toLowerCase()}s is not allowed`;

        console.log(`[ROUTE] BLOCKED: ${errorMsg}`);
        socket.emit('error', { code: 'MESSAGE_BLOCKED', message: errorMsg });
        callback?.({ success: false, error: errorMsg });
        return;
      }

      // 5. Store message
      const isRelayed = decision === RouteDecision.RELAYED;
      const message = addMessage({
        thread_id: threadId,
        sender_id: user.userId,
        sender_role: user.role,
        sender_name: user.displayName,
        type,
        content: type === 'FILE' ? null : (content || null),
        file_url: fileUrl || null,
        file_name: fileName || null,
        file_size: fileSize || null,
        file_type: fileType || null,
        reply_to_id: replyToId || null,
        relayed: isRelayed ? 1 : 0,
        original_sender_id: isRelayed ? user.userId : null,
        relayed_to_id: isRelayed ? recipient.id : null,
      });

      console.log(`[MSG] Stored message ${message.id} in thread ${threadId} (relayed=${isRelayed})`);

      // 6. Build emission payload (with _replyTo if applicable)
      let emitPayload: any = { ...message };
      if (replyToId) {
        const repliedMessage = getMessageById(replyToId);
        if (repliedMessage) {
          emitPayload._replyTo = {
            id: repliedMessage.id,
            sender_id: repliedMessage.sender_id,
            sender_name: repliedMessage.sender_name,
            content: repliedMessage.content,
            type: repliedMessage.type,
            file_name: repliedMessage.file_name,
            created_at: repliedMessage.created_at,
          };
        }
      }

      // 7. Emit 'message:new' to recipient socket(s)
      const recipientSockets = getSocketsForUser(io, recipient.id);
      for (const rs of recipientSockets) {
        rs.emit('message:new', emitPayload);
        // Emit delivered acknowledgment immediately if recipient is online
        rs.emit('message:delivered', { messageId: message.id, threadId });
      }

      // If recipient is online, update status to DELIVERED and notify sender
      if (recipientSockets.length > 0) {
        updateMessageStatus([message.id], 'DELIVERED');
        socket.emit('message:status', {
          threadId,
          messageIds: [message.id],
          status: 'DELIVERED',
        });
      }

      // Also emit back to sender for confirmation
      socket.emit('message:new', emitPayload);

      // 8. Emit 'thread:updated' to both sender and recipient
      const updatedThread = getThreadById(threadId);
      if (updatedThread) {
        const senderSockets = getSocketsForUser(io, user.userId);
        for (const ss of senderSockets) {
          ss.emit('thread:updated', updatedThread);
        }
        for (const rs of recipientSockets) {
          rs.emit('thread:updated', updatedThread);
        }
      }

      // 9. If relayed, notify all online admins
      if (isRelayed) {
        const adminSockets = getOnlineAdminSockets(io);
        for (const adminSocket of adminSockets) {
          adminSocket.emit('message:new', {
            ...emitPayload,
            _relayed: true,
            _relayedFrom: `${user.role}:${user.displayName}`,
            _relayedTo: `${recipient.role}:${recipient.name}`,
          });
          // Also update thread for admins who may be watching
          if (updatedThread) {
            adminSocket.emit('thread:updated', updatedThread);
          }
        }
        console.log(`[RELAY] Notified ${adminSockets.length} online admins about relayed message`);
      }

      callback?.({ success: true, message: emitPayload });
    });

    // ====== MESSAGE:DELETE ======
    socket.on('message:delete', (data: { messageId: string; threadId: string }, callback?: (response: any) => void) => {
      const { messageId, threadId } = data;

      const thread = getThreadById(threadId);
      if (!thread) {
        socket.emit('error', { code: 'THREAD_NOT_FOUND', message: 'Thread not found' });
        callback?.({ success: false, error: 'Thread not found' });
        return;
      }

      // Verify participation
      const isParticipant =
        (thread.participant_a_id === user.userId && thread.participant_a_role === user.role) ||
        (thread.participant_b_id === user.userId && thread.participant_b_role === user.role);

      if (!isParticipant) {
        callback?.({ success: false, error: 'Not a participant' });
        return;
      }

      try {
        softDeleteMessage(messageId, user.userId);

        // Emit to all sockets in the thread room
        io.to(threadId).emit('message:deleted', {
          messageId,
          deletedBy: user.userId,
        });

        console.log(`[MSG] Message ${messageId} deleted by ${user.displayName} in thread ${threadId}`);
        callback?.({ success: true });
      } catch (err: any) {
        socket.emit('error', { code: 'DELETE_FAILED', message: err.message });
        callback?.({ success: false, error: err.message });
      }
    });

    // ====== REACTION:ADD ======
    socket.on('reaction:add', (data: { messageId: string; threadId: string; emoji: string }, callback?: (response: any) => void) => {
      const { messageId, threadId, emoji } = data;

      const thread = getThreadById(threadId);
      if (!thread) {
        socket.emit('error', { code: 'THREAD_NOT_FOUND', message: 'Thread not found' });
        callback?.({ success: false, error: 'Thread not found' });
        return;
      }

      // Verify participation
      const isParticipant =
        (thread.participant_a_id === user.userId && thread.participant_a_role === user.role) ||
        (thread.participant_b_id === user.userId && thread.participant_b_role === user.role);

      if (!isParticipant) {
        callback?.({ success: false, error: 'Not a participant' });
        return;
      }

      // Validate the message exists in this thread
      const message = getMessageById(messageId);
      if (!message || message.thread_id !== threadId) {
        callback?.({ success: false, error: 'Message not found in this thread' });
        return;
      }

      try {
        const reaction = addReaction(messageId, user.userId, user.displayName, emoji);

        io.to(threadId).emit('reaction:added', {
          reaction,
          messageId,
        });

        console.log(`[REACTION] ${user.displayName} added ${emoji} to message ${messageId}`);
        callback?.({ success: true, reaction });
      } catch (err: any) {
        socket.emit('error', { code: 'REACTION_FAILED', message: err.message });
        callback?.({ success: false, error: err.message });
      }
    });

    // ====== REACTION:REMOVE ======
    socket.on('reaction:remove', (data: { messageId: string; threadId: string; emoji: string }, callback?: (response: any) => void) => {
      const { messageId, threadId, emoji } = data;

      const thread = getThreadById(threadId);
      if (!thread) {
        socket.emit('error', { code: 'THREAD_NOT_FOUND', message: 'Thread not found' });
        callback?.({ success: false, error: 'Thread not found' });
        return;
      }

      // Verify participation
      const isParticipant =
        (thread.participant_a_id === user.userId && thread.participant_a_role === user.role) ||
        (thread.participant_b_id === user.userId && thread.participant_b_role === user.role);

      if (!isParticipant) {
        callback?.({ success: false, error: 'Not a participant' });
        return;
      }

      try {
        removeReaction(messageId, user.userId, emoji);

        io.to(threadId).emit('reaction:removed', {
          messageId,
          userId: user.userId,
          emoji,
        });

        console.log(`[REACTION] ${user.displayName} removed ${emoji} from message ${messageId}`);
        callback?.({ success: true });
      } catch (err: any) {
        socket.emit('error', { code: 'REACTION_FAILED', message: err.message });
        callback?.({ success: false, error: err.message });
      }
    });

    // ====== TYPING:START ======
    socket.on('typing:start', (data: { threadId: string }) => {
      const { threadId } = data;
      const thread = getThreadById(threadId);
      if (!thread) return;

      const recipient = getRecipient(thread, user.userId);
      if (!recipient) return;

      const recipientSockets = getSocketsForUser(io, recipient.id);
      for (const rs of recipientSockets) {
        rs.emit('user:typing', { threadId, userId: user.userId, userName: user.displayName });
      }
    });

    // ====== TYPING:STOP ======
    socket.on('typing:stop', (data: { threadId: string }) => {
      const { threadId } = data;
      const thread = getThreadById(threadId);
      if (!thread) return;

      const recipient = getRecipient(thread, user.userId);
      if (!recipient) return;

      const recipientSockets = getSocketsForUser(io, recipient.id);
      for (const rs of recipientSockets) {
        rs.emit('user:typing', { threadId, userId: user.userId, userName: user.displayName, isTyping: false });
      }
    });

    // ====== MESSAGE:READ ======
    socket.on('message:read', (data: { threadId: string; messageIds?: string[] }, callback?: (response: any) => void) => {
      const { threadId, messageIds } = data;

      const thread = getThreadById(threadId);
      if (!thread) {
        callback?.({ success: false, error: 'Thread not found' });
        return;
      }

      // Verify participation
      const isParticipant =
        (thread.participant_a_id === user.userId && thread.participant_a_role === user.role) ||
        (thread.participant_b_id === user.userId && thread.participant_b_role === user.role);

      if (!isParticipant) {
        callback?.({ success: false, error: 'Not a participant' });
        return;
      }

      // Collect message IDs that are transitioning from DELIVERED to READ (for status notifications)
      let statusChangeIds: string[] = [];
      if (messageIds && messageIds.length > 0) {
        // Check which messages are actually transitioning status
        const messages = getMessages(threadId, { limit: 200 });
        statusChangeIds = messages
          .filter(m => messageIds.includes(m.id) && m.status !== 'READ' && m.sender_id !== user.userId)
          .map(m => m.id);

        updateMessageStatus(messageIds, 'READ');
      }

      // Mark thread as read for this user
      markAsRead(threadId, user.userId);

      // If there were specific messageIds, also update those to READ
      // (markAsRead already handles bulk, but for specific IDs we do it above)

      // Notify the other participant that messages were read
      const recipient = getRecipient(thread, user.userId);
      if (recipient) {
        const recipientSockets = getSocketsForUser(io, recipient.id);
        for (const rs of recipientSockets) {
          rs.emit('message:read', { threadId, readBy: user.userId, messageIds: messageIds || [] });
          rs.emit('thread:updated', getThreadById(threadId));

          // Notify sender about READ status change
          if (statusChangeIds.length > 0) {
            rs.emit('message:status', {
              threadId,
              messageIds: statusChangeIds,
              status: 'READ',
            });
          }
        }
      }

      // Also update the thread for sender
      const updatedThread = getThreadById(threadId);
      if (updatedThread) {
        socket.emit('thread:updated', updatedThread);
      }

      callback?.({ success: true });
    });

    // ====== MESSAGE:DELIVERED ======
    socket.on('message:delivered', (data: { threadId: string; messageIds: string[] }, callback?: (response: any) => void) => {
      const { threadId, messageIds } = data;

      const thread = getThreadById(threadId);
      if (!thread) {
        callback?.({ success: false, error: 'Thread not found' });
        return;
      }

      // Verify participation
      const isParticipant =
        (thread.participant_a_id === user.userId && thread.participant_a_role === user.role) ||
        (thread.participant_b_id === user.userId && thread.participant_b_role === user.role);

      if (!isParticipant) {
        callback?.({ success: false, error: 'Not a participant' });
        return;
      }

      // Only transition SENT → DELIVERED (not DELIVERED → DELIVERED)
      const messages = getMessages(threadId, { limit: 200 });
      const sentIds = messages
        .filter(m => messageIds.includes(m.id) && m.status === 'SENT' && m.sender_id !== user.userId)
        .map(m => m.id);

      if (sentIds.length > 0) {
        updateMessageStatus(sentIds, 'DELIVERED');

        // Notify senders about DELIVERED status
        const senderIds = new Set(
          messages
            .filter(m => sentIds.includes(m.id))
            .map(m => m.sender_id)
            .filter(Boolean)
        );

        for (const senderId of senderIds) {
          const senderSockets = getSocketsForUser(io, senderId);
          for (const ss of senderSockets) {
            const idsForThisSender = messages
              .filter(m => m.sender_id === senderId && sentIds.includes(m.id))
              .map(m => m.id);
            ss.emit('message:status', {
              threadId,
              messageIds: idsForThisSender,
              status: 'DELIVERED',
            });
          }
        }
      }

      callback?.({ success: true });
    });

    // ====== PRESENCE:UPDATE ======
    socket.on('presence:update', (data: { status: 'online' | 'away' | 'busy' }) => {
      const ou = onlineUsers.get(socket.id);
      if (ou) {
        ou.status = data.status;
        console.log(`[PRESENCE] ${user.displayName} → ${data.status}`);
        broadcastPresenceList(io);
      }
    });

    // ====== DISCONNECT ======
    socket.on('disconnect', (reason) => {
      console.log(`[SOCKET] Disconnected: ${socket.id} | ${user.role} ${user.displayName} | reason: ${reason}`);

      const ou = onlineUsers.get(socket.id);
      onlineUsers.delete(socket.id);

      if (ou) {
        // Check if user still has other connected sockets
        const stillOnline = Array.from(onlineUsers.values()).some(
          u => u.userId === ou.userId
        );

        if (!stillOnline) {
          socket.broadcast.emit('user:offline', {
            userId: ou.userId,
            userName: ou.userName,
            role: ou.role,
          });
          console.log(`[PRESENCE] ${ou.userName} fully offline (no remaining sockets)`);
        }

        broadcastPresenceList(io);
      }
    });

    // ====== ERROR HANDLER ======
    socket.on('error', (err) => {
      console.error(`[SOCKET] Error on ${socket.id}:`, err);
    });
  });
}

// Export for REST endpoint usage
export function getOnlineUsersList() {
  // Deduplicate by userId (user may have multiple sockets)
  const seen = new Map<string, OnlineUser>();
  for (const [, user] of onlineUsers) {
    if (!seen.has(user.userId)) {
      seen.set(user.userId, user);
    }
  }
  return Array.from(seen.values()).map(u => ({
    userId: u.userId,
    userName: u.userName,
    role: u.role,
    status: u.status,
  }));
}
