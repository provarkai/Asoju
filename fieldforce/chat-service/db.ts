import { Database } from 'bun:sqlite';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = './data/chat.db';

// Ensure data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

// ====== INTERFACES ======

export interface Thread {
  id: string;
  type: string; // 'DIRECT' or 'RELAYED'
  case_id: string | null;
  subject: string | null;
  participant_a_id: string;
  participant_a_role: string;
  participant_a_name: string;
  participant_b_id: string;
  participant_b_role: string;
  participant_b_name: string;
  last_message: string | null;
  last_message_type: string | null;
  last_message_at: string | null;
  unread_count_a: number;
  unread_count_b: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  thread_id: string;
  sender_id: string;
  sender_role: string;
  sender_name: string;
  type: string; // 'TEXT', 'FILE', 'SYSTEM', 'LOCATION'
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  file_type: string | null;
  reply_to_id: string | null;
  relayed: number;
  original_sender_id: string | null;
  relayed_to_id: string | null;
  status: string; // 'SENT', 'DELIVERED', 'READ'
  deleted: number;
  created_at: string;
}

export interface Reaction {
  id: string;
  message_id: string;
  user_id: string;
  user_name: string;
  emoji: string;
  created_at: string;
}

export interface CreateThreadData {
  id?: string;
  type?: string;
  case_id?: string;
  subject?: string;
  participant_a_id: string;
  participant_a_role: string;
  participant_a_name: string;
  participant_b_id: string;
  participant_b_role: string;
  participant_b_name: string;
}

export interface CreateMessageData {
  id?: string;
  thread_id: string;
  sender_id: string;
  sender_role: string;
  sender_name: string;
  type?: string;
  content?: string | null;
  file_url?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  file_type?: string | null;
  reply_to_id?: string | null;
  relayed?: number;
  original_sender_id?: string | null;
  relayed_to_id?: string | null;
  status?: string;
}

let db: Database;

// ====== SAFE COLUMN ADDITION ======
// SQLite ALTER TABLE ADD COLUMN errors if column exists, so we check first.
function columnExists(tableName: string, columnName: string): boolean {
  try {
    const row = db.query(`SELECT count(*) as cnt FROM pragma_table_info('${tableName}') WHERE name = '${columnName}'`).get() as any;
    return row && row.cnt > 0;
  } catch {
    return false;
  }
}

function safeAddColumn(table: string, column: string, definition: string): void {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[DB] Added column ${table}.${column}`);
  }
}

export function initDatabase(): Database {
  db = new Database(DB_PATH);

  // Enable WAL mode and foreign keys
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'DIRECT',
      case_id TEXT,
      subject TEXT,
      participant_a_id TEXT NOT NULL,
      participant_a_role TEXT NOT NULL,
      participant_a_name TEXT NOT NULL,
      participant_b_id TEXT NOT NULL,
      participant_b_role TEXT NOT NULL,
      participant_b_name TEXT NOT NULL,
      last_message TEXT,
      last_message_type TEXT,
      last_message_at TEXT,
      unread_count_a INTEGER DEFAULT 0,
      unread_count_b INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id),
      sender_id TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      type TEXT DEFAULT 'TEXT',
      content TEXT,
      file_url TEXT,
      file_name TEXT,
      file_size INTEGER,
      file_type TEXT,
      reply_to_id TEXT,
      relayed INTEGER DEFAULT 0,
      original_sender_id TEXT,
      relayed_to_id TEXT,
      status TEXT DEFAULT 'SENT',
      deleted INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_threads_a ON threads(participant_a_id, participant_a_role);
    CREATE INDEX IF NOT EXISTS idx_threads_b ON threads(participant_b_id, participant_b_role);
    CREATE INDEX IF NOT EXISTS idx_reactions_message_id ON reactions(message_id);
  `);

  // Migrations: add columns to existing tables (safe, idempotent)
  safeAddColumn('threads', 'subject', 'TEXT');
  safeAddColumn('threads', 'last_message_type', 'TEXT');
  safeAddColumn('messages', 'reply_to_id', 'TEXT');
  safeAddColumn('messages', 'deleted', "INTEGER DEFAULT 0");

  console.log('[DB] Database initialized at', DB_PATH);
  return db;
}

// ====== THREAD FUNCTIONS ======

export function createThread(data: CreateThreadData): Thread {
  const id = data.id || crypto.randomUUID();
  const now = new Date().toISOString();

  db.query(`
    INSERT INTO threads (id, type, case_id, subject, participant_a_id, participant_a_role, participant_a_name,
                         participant_b_id, participant_b_role, participant_b_name,
                         last_message, last_message_type, last_message_at, unread_count_a, unread_count_b, created_at, updated_at)
    VALUES ($id, $type, $caseId, $subject, $paId, $paRole, $paName, $pbId, $pbRole, $pbName,
            $lastMsg, $lastMsgType, $lastMsgAt, 0, 0, $createdAt, $updatedAt)
  `).run({
    $id: id,
    $type: data.type || 'DIRECT',
    $caseId: data.case_id || null,
    $subject: data.subject || null,
    $paId: data.participant_a_id,
    $paRole: data.participant_a_role,
    $paName: data.participant_a_name,
    $pbId: data.participant_b_id,
    $pbRole: data.participant_b_role,
    $pbName: data.participant_b_name,
    $lastMsg: null,
    $lastMsgType: null,
    $lastMsgAt: null,
    $createdAt: now,
    $updatedAt: now,
  });

  return getThreadById(id)!;
}

export function getThreadsForUser(userId: string, role: string): Thread[] {
  const rows = db.query(`
    SELECT * FROM threads
    WHERE (participant_a_id = $userId AND participant_a_role = $role)
       OR (participant_b_id = $userId AND participant_b_role = $role)
    ORDER BY
      CASE WHEN last_message_at IS NULL THEN 1 ELSE 0 END,
      last_message_at DESC,
      created_at DESC
  `).all({ $userId: userId, $role: role }) as any[];

  return rows;
}

export function getThreadById(id: string): Thread | undefined {
  return db.query('SELECT * FROM threads WHERE id = $id').get({ $id: id }) as Thread | undefined;
}

// ====== MESSAGE FUNCTIONS ======

export function addMessage(data: CreateMessageData): Message {
  const id = data.id || crypto.randomUUID();
  const now = new Date().toISOString();

  const thread = getThreadById(data.thread_id);
  if (!thread) {
    throw new Error(`Thread not found: ${data.thread_id}`);
  }

  // Determine which side is the recipient to increment unread count
  const isSenderA = thread.participant_a_id === data.sender_id;
  const messageType = data.type || 'TEXT';
  const lastMessagePreview = messageType === 'FILE'
    ? `📎 ${data.file_name || 'File'}`
    : (data.content || '').substring(0, 100);

  // Use a transaction for atomicity
  db.transaction(() => {
    db.query(`
      INSERT INTO messages (id, thread_id, sender_id, sender_role, sender_name, type, content,
                           file_url, file_name, file_size, file_type, reply_to_id,
                           relayed, original_sender_id, relayed_to_id, status, deleted, created_at)
      VALUES ($id, $threadId, $senderId, $senderRole, $senderName, $type, $content,
              $fileUrl, $fileName, $fileSize, $fileType, $replyToId,
              $relayed, $origSenderId, $relayedToId, $status, 0, $createdAt)
    `).run({
      $id: id,
      $threadId: data.thread_id,
      $senderId: data.sender_id,
      $senderRole: data.sender_role,
      $senderName: data.sender_name,
      $type: messageType,
      $content: data.content || null,
      $fileUrl: data.file_url || null,
      $fileName: data.file_name || null,
      $fileSize: data.file_size || null,
      $fileType: data.file_type || null,
      $replyToId: data.reply_to_id || null,
      $relayed: data.relayed || 0,
      $origSenderId: data.original_sender_id || null,
      $relayedToId: data.relayed_to_id || null,
      $status: data.status || 'SENT',
      $createdAt: now,
    });

    // isSenderA=true means sender is A, so increment B's unread count
    // isSenderA=false means sender is B, so increment A's unread count
    db.query(`
      UPDATE threads
      SET last_message = $lastMsg,
          last_message_type = $lastMsgType,
          last_message_at = $lastMsgAt,
          unread_count_a = CASE
            WHEN $incrementA = 1 THEN unread_count_a + 1
            ELSE unread_count_a
          END,
          unread_count_b = CASE
            WHEN $incrementB = 1 THEN unread_count_b + 1
            ELSE unread_count_b
          END,
          updated_at = $updatedAt
      WHERE id = $threadId
    `).run({
      $lastMsg: lastMessagePreview,
      $lastMsgType: messageType,
      $lastMsgAt: now,
      $incrementA: isSenderA ? 0 : 1,  // increment A if sender is B
      $incrementB: isSenderA ? 1 : 0,  // increment B if sender is A
      $updatedAt: now,
      $threadId: data.thread_id,
    });
  })();

  const msg = db.query('SELECT * FROM messages WHERE id = $id').get({ $id: id }) as Message;
  return msg;
}

export function getMessages(threadId: string, options?: { before?: string; limit?: number }): Message[] {
  const limit = options?.limit || 50;

  if (options?.before) {
    const rows = db.query(`
      SELECT * FROM messages
      WHERE thread_id = $threadId AND created_at < $before AND deleted = 0
      ORDER BY created_at DESC
      LIMIT $limit
    `).all({ $threadId: threadId, $before: options.before, $limit: limit }) as any[];
    return rows.reverse();
  }

  const rows = db.query(`
    SELECT * FROM messages
    WHERE thread_id = $threadId AND deleted = 0
    ORDER BY created_at DESC
    LIMIT $limit
  `).all({ $threadId: threadId, $limit: limit }) as any[];
  return rows.reverse();
}

export function markAsRead(threadId: string, userId: string): void {
  const thread = getThreadById(threadId);
  if (!thread) return;

  if (thread.participant_a_id === userId) {
    db.query('UPDATE threads SET unread_count_a = 0, updated_at = $now WHERE id = $id').run({
      $now: new Date().toISOString(),
      $id: threadId,
    });
    db.query(`
      UPDATE messages SET status = 'READ'
      WHERE thread_id = $threadId AND sender_id != $userId AND status != 'READ' AND deleted = 0
    `).run({ $threadId: threadId, $userId: userId });
  } else if (thread.participant_b_id === userId) {
    db.query('UPDATE threads SET unread_count_b = 0, updated_at = $now WHERE id = $id').run({
      $now: new Date().toISOString(),
      $id: threadId,
    });
    db.query(`
      UPDATE messages SET status = 'READ'
      WHERE thread_id = $threadId AND sender_id != $userId AND status != 'READ' AND deleted = 0
    `).run({ $threadId: threadId, $userId: userId });
  }

  console.log(`[DB] Thread ${threadId} marked as read by ${userId}`);
}

export function getMessageById(id: string): Message | undefined {
  return db.query('SELECT * FROM messages WHERE id = $id').get({ $id: id }) as Message | undefined;
}

export function updateMessageStatus(messageIds: string[], status: string): void {
  db.transaction(() => {
    const stmt = db.query('UPDATE messages SET status = $status WHERE id = $id AND deleted = 0');
    for (const id of messageIds) {
      stmt.run({ $status: status, $id: id });
    }
  })();
}

// ====== MESSAGE SOFT DELETE ======

export function softDeleteMessage(messageId: string, userId: string): Message | undefined {
  const message = getMessageById(messageId);
  if (!message) {
    throw new Error('Message not found');
  }
  if (message.sender_id !== userId) {
    throw new Error('Only the sender can delete this message');
  }

  db.query('UPDATE messages SET deleted = 1 WHERE id = $id').run({ $id: messageId });
  console.log(`[DB] Message ${messageId} soft-deleted by ${userId}`);

  return db.query('SELECT * FROM messages WHERE id = $id').get({ $id: messageId }) as Message;
}

// ====== REACTIONS ======

export function addReaction(messageId: string, userId: string, userName: string, emoji: string): Reaction {
  const id = crypto.randomUUID();

  // Prevent duplicate reaction (same user + same emoji on same message)
  const existing = db.query(
    'SELECT id FROM reactions WHERE message_id = $messageId AND user_id = $userId AND emoji = $emoji'
  ).get({ $messageId: messageId, $userId: userId, $emoji: emoji });

  if (existing) {
    return db.query('SELECT * FROM reactions WHERE id = $id').get({ $id: (existing as any).id }) as Reaction;
  }

  db.query(`
    INSERT INTO reactions (id, message_id, user_id, user_name, emoji, created_at)
    VALUES ($id, $messageId, $userId, $userName, $emoji, datetime('now'))
  `).run({
    $id: id,
    $messageId: messageId,
    $userId: userId,
    $userName: userName,
    $emoji: emoji,
  });

  console.log(`[DB] Reaction added: ${emoji} by ${userName} on message ${messageId}`);
  return db.query('SELECT * FROM reactions WHERE id = $id').get({ $id: id }) as Reaction;
}

export function removeReaction(messageId: string, userId: string, emoji: string): void {
 db.query(
    'DELETE FROM reactions WHERE message_id = $messageId AND user_id = $userId AND emoji = $emoji'
  ).run({ $messageId: messageId, $userId: userId, $emoji: emoji });

  console.log(`[DB] Reaction removed: ${emoji} by ${userId} on message ${messageId}`);
}

export function getReactionsForMessages(messageIds: string[]): Map<string, Reaction[]> {
  const result = new Map<string, Reaction[]>();
  if (messageIds.length === 0) return result;

  // Build placeholders for IN clause
  const placeholders = messageIds.map(() => '?').join(',');
  const rows = db.query(
    `SELECT * FROM reactions WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`
  ).all(...messageIds) as Reaction[];

  for (const row of rows) {
    const existing = result.get(row.message_id) || [];
    existing.push(row);
    result.set(row.message_id, existing);
  }

  return result;
}

// ====== MESSAGE SEARCH ======

export interface MessageSearchResult {
  id: string;
  thread_id: string;
  sender_id: string;
  sender_role: string;
  sender_name: string;
  type: string;
  content: string | null;
  status: string;
  created_at: string;
  thread: {
    id: string;
    type: string;
    subject: string | null;
    participant_a_name: string;
    participant_b_name: string;
  };
}

export function searchMessages(userId: string, query: string, limit: number = 20): MessageSearchResult[] {
  const likePattern = `%${query}%`;
  const rows = db.query(`
    SELECT m.id, m.thread_id, m.sender_id, m.sender_role, m.sender_name, m.type, m.content, m.status, m.created_at,
           t.id AS t_id, t.type AS t_type, t.subject AS t_subject,
           t.participant_a_name AS t_pa_name, t.participant_b_name AS t_pb_name
    FROM messages m
    JOIN threads t ON m.thread_id = t.id
    WHERE (m.sender_id = $userId
           OR t.participant_a_id = $userId
           OR t.participant_b_id = $userId)
      AND m.content LIKE $query
      AND m.deleted = 0
    ORDER BY m.created_at DESC
    LIMIT $limit
  `).all({ $userId: userId, $query: likePattern, $limit: limit }) as any[];

  return rows.map(row => ({
    id: row.id,
    thread_id: row.thread_id,
    sender_id: row.sender_id,
    sender_role: row.sender_role,
    sender_name: row.sender_name,
    type: row.type,
    content: row.content,
    status: row.status,
    created_at: row.created_at,
    thread: {
      id: row.t_id,
      type: row.t_type,
      subject: row.t_subject,
      participant_a_name: row.t_pa_name,
      participant_b_name: row.t_pb_name,
    },
  }));
}

// Placeholder — actual online users managed in handler.ts
export function getOnlineUsers(): { userId: string; userName: string; role: string; status: string }[] {
  return [];
}
