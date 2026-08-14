# Task 1: ASOJU FieldForce Chat Service Mini-Service

## Agent: chat-service-builder

## Work Log

### Files Created
- `mini-services/chat-service/package.json` — Dependencies: socket.io, jose, express, multer, cors, uuid. Dev script uses `bun index.ts` (no --hot/--watch due to SQLite WAL file conflicts).
- `mini-services/chat-service/tsconfig.json` — ES2022 target, ESNext modules, bundler resolution.
- `mini-services/chat-service/db.ts` — SQLite database layer using `bun:sqlite` (better-sqlite3 not supported in Bun runtime). Tables: `threads`, `messages` with proper indexes. Exports: initDatabase, createThread, getThreadsForUser, getThreadById, addMessage, getMessages, markAsRead, updateMessageStatus, getMessageById.
- `mini-services/chat-service/auth.ts` — JWT verification using `jose` library. Supports tokens from all 3 portals (agent, admin, customer issuers). Also supports BFF header authentication (X-User-Id, X-User-Role, X-User-Name).
- `mini-services/chat-service/handler.ts` — Socket.IO event handlers with star topology routing. Implements message routing rules (ALLOWED/BLOCKED/RELAYED), online presence tracking, typing indicators, message read receipts. All relayed Agent↔Customer messages are broadcast to online admins.
- `mini-services/chat-service/index.ts` — Main server entry with manual request routing (Bun runtime quirk: Socket.IO with path='/' intercepts all requests). REST routes on Express, Socket.IO engine with internal path `/_engine`, Caddy-facing path `/`. REST endpoints: health, threads CRUD, messages, upload, files, presence.
- `mini-services/chat-service/uploads/.gitkeep`
- `mini-services/chat-service/data/` — Created at runtime.

### Key Architecture Decisions

1. **bun:sqlite instead of better-sqlite3**: Bun runtime doesn't support better-sqlite3 native module. Used built-in `bun:sqlite` with equivalent API (parameterized queries with `$param` syntax).

2. **Manual request routing**: Socket.IO with `path: '/'` intercepts ALL HTTP requests in Bun runtime (Engine.IO doesn't pass through non-transport requests). Solution: Create Socket.IO with `attach: false` and internal path `/_engine`, then manually route requests based on `?EIO=` query param presence.

3. **No --hot/--watch**: Bun's file watchers trigger restarts when SQLite WAL/SHM files change, causing port conflicts. Dev script uses `bun index.ts` directly.

### Test Results (all passed)
- Health check: ✅ `GET /health`
- Socket.IO handshake: ✅ polling transport at `/?EIO=4&transport=polling`
- Create DIRECT thread: ✅ Admin→Agent auto-detected as DIRECT
- Create RELAYED thread: ✅ Agent→Customer auto-detected as RELAYED
- List threads: ✅ Filters by userId+role correctly
- Thread detail: ✅ BOLA/IDOR check, admins can view any thread
- 401 unauthorized: ✅ No auth headers returns 401
- 404 thread: ✅ Returns proper error
- 403 forbidden: ✅ Non-participants blocked
- Mark as read: ✅ Resets unread counts
- Presence: ✅ Returns online users list

## Stage Summary
- 6 source files created, 1 package.json, 1 tsconfig.json, 2 directories
- Full REST API (8 endpoints) + Socket.IO (8 event types) operational
- Star topology message routing with 3 rules: ALLOWED (admin↔any), BLOCKED (agent↔customer text, same-role), RELAYED (agent↔customer file)
- No message deletion (audit compliance)
- Admin monitors all relayed messages
- Port 3005, Caddy-compatible Socket.IO path `/`
