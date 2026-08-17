Task ID: chat-enhance
Agent: Main Agent
Task: Enhance ASOJU FieldForce chat service with reactions, reply-to, soft delete, delivered tracking, search, thread metadata

Work Log:
- Read all 5 existing files (index.ts, handler.ts, db.ts, auth.ts, package.json) to understand patterns
- Updated db.ts:
  - Added `Reaction` interface and `MessageSearchResult` interface
  - Added `subject` and `last_message_type` to `Thread` interface
  - Added `reply_to_id` and `deleted` to `Message` interface
  - Added `reply_to_id` to `CreateMessageData` interface
  - Created `reactions` table with index on `message_id`
  - Added safe column migration helper `safeAddColumn` for idempotent ALTER TABLE
  - Added `subject`, `last_message_type` columns to threads table (schema + migration)
  - Added `reply_to_id`, `deleted` columns to messages table (schema + migration)
  - Created `addReaction()` — insert with duplicate prevention (same user+emoji+message)
  - Created `removeReaction()` — delete by message+user+emoji
  - Created `getReactionsForMessages()` — bulk fetch returning Map<messageId, Reaction[]>
  - Created `softDeleteMessage()` — sender-only delete, sets deleted=1
  - Created `searchMessages()` — full-text search with LIKE, joins thread info, excludes deleted
  - Updated `createThread()` to include `subject` and `last_message_type`
  - Updated `addMessage()` to include `reply_to_id` and track `last_message_type`
  - Updated `getMessages()` to filter `deleted = 0`
  - Updated `markAsRead()` to filter `deleted = 0`
  - Updated `updateMessageStatus()` to filter `deleted = 0`
- Updated handler.ts:
  - Changed auth middleware to dynamic import of verifyToken (keeps top-level imports clean)
  - Added `reaction:add` socket event → validates participation, creates reaction, emits `reaction:added` to thread room
  - Added `reaction:remove` socket event → validates participation, removes reaction, emits `reaction:removed` to thread room
  - Enhanced `message:send` handler:
    - Accepts `replyToId` in data payload
    - Validates replyToId points to a message in the same thread
    - Fetches replied message and attaches `_replyTo` object to emitted payload
    - Stores `reply_to_id` in database
    - Emits `message:delivered` to recipient sockets immediately
    - If recipient is online, auto-transitions SENT→DELIVERED and emits `message:status` to sender
  - Added `message:delete` socket event → validates sender, soft deletes, emits `message:deleted` to thread room
  - Enhanced `thread:join` handler:
    - Auto-marks SENT messages as DELIVERED when recipient joins
    - Notifies senders via `message:status` event
  - Enhanced `message:read` handler:
    - Tracks status transitions (DELIVERED→READ) and emits `message:status` to sender
  - Added `message:delivered` socket event:
    - Recipient can explicitly mark messages as delivered
    - Only transitions SENT→DELIVERED (no-op if already DELIVERED/READ)
    - Notifies senders via `message:status`
- Updated index.ts:
  - Added import of `softDeleteMessage` and `searchMessages`
  - Added `subject` parameter to POST /api/threads body
  - Added `DELETE /api/messages/:id` REST endpoint — calls softDeleteMessage
  - Added `GET /api/search?q=query&limit=20` REST endpoint — full message search
  - Updated startup banner to show new endpoints
- Updated package.json:
  - Changed dev script from `bun index.ts` to `bun --hot index.ts` for auto-reload
- Verified all 3 TypeScript files compile cleanly with `bun build --no-bundle`
- auth.ts was NOT modified (per requirements)

Stage Summary:
- 6 new features implemented across 4 files (db.ts, handler.ts, index.ts, package.json)
- All schema changes use safe idempotent migration pattern (safeAddColumn)
- Message reactions: add/remove with duplicate prevention, room broadcast
- Reply-to: validated cross-thread reference, _replyTo payload enrichment
- Soft delete: sender-only, filters in all queries, socket + REST delete
- Delivered tracking: auto on join, explicit event, SENT→DELIVERED→READ status flow
- Search: LIKE-based full-text search with thread info, REST endpoint
- Thread metadata: subject and last_message_type columns
- Zero compilation errors
