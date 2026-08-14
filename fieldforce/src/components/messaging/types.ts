export interface ChatThread {
  id: string;
  type: 'DIRECT' | 'RELAYED';
  case_id: string | null;
  participant_a_id: string;
  participant_a_role: 'AGENT' | 'ADMIN' | 'CUSTOMER';
  participant_a_name: string;
  participant_b_id: string;
  participant_b_role: 'AGENT' | 'ADMIN' | 'CUSTOMER';
  participant_b_name: string;
  last_message: string | null;
  last_message_at: string | null;
  unread_count_a: number;
  unread_count_b: number;
  created_at: string;
  updated_at: string;
  // Extended metadata (populated by server)
  last_message_type?: string | null;
  last_message_is_reply?: number;
}

export interface ChatReaction {
  id: string;
  message_id: string;
  user_id: string;
  user_name: string;
  emoji: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  sender_role: 'AGENT' | 'ADMIN' | 'CUSTOMER';
  sender_name: string;
  type: 'TEXT' | 'FILE' | 'SYSTEM' | 'LOCATION';
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  file_type: string | null;
  relayed: number;
  original_sender_id: string | null;
  relayed_to_id: string | null;
  status: 'SENT' | 'DELIVERED' | 'READ';
  created_at: string;
  // Extended fields
  reply_to_id?: string | null;
  deleted?: number;
  // Client-only fields (added by server for relayed messages)
  _relayed?: boolean;
  _relayedFrom?: string;
  _relayedTo?: string;
  // Populated by server: reply-to context
  _replyTo?: { id: string; content: string | null; sender_name: string; type: string } | null;
  // Populated by server: reaction data
  _reactions?: ChatReaction[];
}

export interface OnlineUser {
  userId: string;
  userName: string;
  role: string;
  status: 'online' | 'away' | 'busy';
}

export interface ChatUser {
  userId: string;
  role: 'AGENT' | 'ADMIN' | 'CUSTOMER';
  displayName: string;
}

// Helper: get unread count for a specific user in a thread
export function getUnreadCount(thread: ChatThread, userId: string): number {
  if (thread.participant_a_id === userId) return thread.unread_count_a;
  if (thread.participant_b_id === userId) return thread.unread_count_b;
  return 0;
}

// Helper: get the other participant in a thread
export function getOtherParticipant(thread: ChatThread, userId: string): { id: string; role: string; name: string } | null {
  if (thread.participant_a_id === userId) {
    return { id: thread.participant_b_id, role: thread.participant_b_role, name: thread.participant_b_name };
  }
  if (thread.participant_b_id === userId) {
    return { id: thread.participant_a_id, role: thread.participant_a_role, name: thread.participant_a_name };
  }
  return null;
}

// Helper: format file size
export function formatFileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Helper: format message time
export function formatMessageTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return new Date(iso).toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
  });
}

// Helper: format full message time (for hover tooltip)
export function formatFullTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Helper: format date separator label
export function formatDateSeparator(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - msgDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';

  return date.toLocaleDateString('en-NG', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// Helper: check if two ISO date strings are on the same calendar day
export function isSameDay(isoA: string, isoB: string): boolean {
  const a = new Date(isoA);
  const b = new Date(isoB);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
