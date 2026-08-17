import express from 'express';
import { createServer, IncomingMessage, ServerResponse, type Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseUrl } from 'url';

import {
  initDatabase,
  createThread,
  getThreadsForUser,
  getThreadById,
  getMessages,
  markAsRead,
  softDeleteMessage,
  searchMessages,
} from './db.js';
import { authenticateRequest } from './auth.js';
import { registerHandlers, getOnlineUsersList } from './handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3005;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Ensure upload directory exists
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Initialize database
initDatabase();

// ====== EXPRESS APP (for REST routes) ======
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ====== MULTER CONFIG ======
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
});

// ====== AUTH MIDDLEWARE FOR REST ======
async function restAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authUser = await authenticateRequest(req.headers as Record<string, string | string[] | undefined>);
    (req as any).user = authUser;
    next();
  } catch (err: any) {
    res.status(401).json({ error: err.message });
  }
}

// ====== REST ROUTES ======

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'asoju-chat-service', port: PORT, timestamp: new Date().toISOString() });
});

app.get('/api/presence', (_req, res) => {
  res.json({ users: getOnlineUsersList() });
});

app.get('/api/threads', restAuth, (req: express.Request, res: express.Response) => {
  try {
    const { userId, role } = (req as any).user;
    const threads = getThreadsForUser(userId, role);
    res.json({ threads });
  } catch (err: any) {
    console.error('[REST] GET /api/threads error:', err.message);
    res.status(500).json({ error: 'Failed to fetch threads' });
  }
});

app.post('/api/threads', restAuth, (req: express.Request, res: express.Response) => {
  try {
    const { userId, role, displayName } = (req as any).user;
    const { participantBId, participantBRole, participantBName, type, caseId, subject } = req.body;

    if (!participantBId || !participantBRole || !participantBName) {
      res.status(400).json({ error: 'participantBId, participantBRole, and participantBName are required' });
      return;
    }

    let threadType = 'DIRECT';
    if ((role === 'AGENT' && participantBRole === 'CUSTOMER') || (role === 'CUSTOMER' && participantBRole === 'AGENT')) {
      threadType = 'RELAYED';
    }
    if (type && ['DIRECT', 'RELAYED'].includes(type)) {
      threadType = type;
    }

    const thread = createThread({
      participant_a_id: userId,
      participant_a_role: role,
      participant_a_name: displayName,
      participant_b_id: participantBId,
      participant_b_role: participantBRole,
      participant_b_name: participantBName,
      type: threadType,
      case_id: caseId || undefined,
      subject: subject || undefined,
    });

    console.log(`[REST] Thread created: ${thread.id} (${threadType}) between ${role}:${displayName} and ${participantBRole}:${participantBName}`);
    res.status(201).json({ thread });
  } catch (err: any) {
    console.error('[REST] POST /api/threads error:', err.message);
    res.status(500).json({ error: 'Failed to create thread' });
  }
});

app.get('/api/threads/:id', restAuth, (req: express.Request, res: express.Response) => {
  try {
    const { userId, role } = (req as any).user;
    const thread = getThreadById(req.params.id);

    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    const isParticipant =
      (thread.participant_a_id === userId && thread.participant_a_role === role) ||
      (thread.participant_b_id === userId && thread.participant_b_role === role) ||
      role === 'ADMIN';

    if (!isParticipant) {
      res.status(403).json({ error: 'You are not a participant in this thread' });
      return;
    }

    res.json({ thread });
  } catch (err: any) {
    console.error(`[REST] GET /api/threads/${req.params.id} error:`, err.message);
    res.status(500).json({ error: 'Failed to fetch thread' });
  }
});

app.get('/api/threads/:id/messages', restAuth, (req: express.Request, res: express.Response) => {
  try {
    const { userId, role } = (req as any).user;
    const threadId = req.params.id;
    const { before, limit } = req.query;

    const thread = getThreadById(threadId);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    const isParticipant =
      (thread.participant_a_id === userId && thread.participant_a_role === role) ||
      (thread.participant_b_id === userId && thread.participant_b_role === role) ||
      role === 'ADMIN';

    if (!isParticipant) {
      res.status(403).json({ error: 'Not a participant' });
      return;
    }

    const messages = getMessages(threadId, {
      before: before as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : 50,
    });

    res.json({ messages });
  } catch (err: any) {
    console.error(`[REST] GET /api/threads/${req.params.id}/messages error:`, err.message);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/threads/:id/read', restAuth, (req: express.Request, res: express.Response) => {
  try {
    const { userId } = (req as any).user;
    const threadId = req.params.id;

    const thread = getThreadById(threadId);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    markAsRead(threadId, userId);

    const updatedThread = getThreadById(threadId);
    res.json({ success: true, thread: updatedThread });
  } catch (err: any) {
    console.error(`[REST] POST /api/threads/${req.params.id}/read error:`, err.message);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

app.post('/api/upload', restAuth, upload.single('file'), (req: express.Request, res: express.Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided. Use multipart form with field name "file"' });
      return;
    }

    const { userId, displayName } = (req as any).user;
    const fileUrl = `/api/files/${req.file.filename}`;

    console.log(`[UPLOAD] ${displayName} (${userId}) uploaded ${req.file.originalname} → ${req.file.filename} (${req.file.size} bytes)`);

    res.json({
      url: fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileType: req.file.mimetype,
    });
  } catch (err: any) {
    console.error('[REST] POST /api/upload error:', err.message);
    res.status(500).json({ error: 'File upload failed' });
  }
});

app.get('/api/files/:filename', (req: express.Request, res: express.Response) => {
  const filePath = path.join(UPLOAD_DIR, req.params.filename);

  if (!existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  res.sendFile(filePath);
});

// ====== MESSAGE DELETE ENDPOINT ======
app.delete('/api/messages/:id', restAuth, (req: express.Request, res: express.Response) => {
  try {
    const { userId } = (req as any).user;
    const messageId = req.params.id;

    const deletedMessage = softDeleteMessage(messageId, userId);
    res.json({ success: true, message: deletedMessage });
  } catch (err: any) {
    const status = err.message.includes('not found') ? 404 : 403;
    res.status(status).json({ error: err.message });
  }
});

// ====== MESSAGE SEARCH ENDPOINT ======
app.get('/api/search', restAuth, (req: express.Request, res: express.Response) => {
  try {
    const { userId } = (req as any).user;
    const query = req.query.q as string;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

    if (!query || query.trim().length === 0) {
      res.status(400).json({ error: 'Query parameter "q" is required' });
      return;
    }

    if (limit < 1 || limit > 100) {
      res.status(400).json({ error: 'Limit must be between 1 and 100' });
      return;
    }

    const results = searchMessages(userId, query.trim(), limit);
    res.json({ results, query: query.trim(), count: results.length });
  } catch (err: any) {
    console.error('[REST] GET /api/search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ====== HTTP SERVER + SOCKET.IO WITH MANUAL ROUTING ======
// Bun runtime: Socket.IO with path='/' intercepts ALL requests (Engine.IO bug).
// Solution: Create Socket.IO with internal path '/_engine', then manually route
// Socket.IO transport requests (identified by ?EIO= query param) to the engine,
// while everything else goes to Express.

const httpServer = createServer();

// Create Socket.IO with attach=false to prevent it from installing its own
// request handler on the httpServer.
const io = new Server(httpServer, {
  path: '/_engine',
  attach: false,
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  serveClient: false,
});

// Register Socket.IO event handlers
registerHandlers(io);

// Install our own request handler that routes between Socket.IO and Express
httpServer.on('request', (req: IncomingMessage, res: ServerResponse) => {
  const parsedUrl = parseUrl(req.url || '/', true);
  const query = parsedUrl.query;

  // Socket.IO transport requests have ?EIO=4 (or ?EIO=3) in query
  if (query.EIO) {
    // Rewrite URL to match Engine.IO's internal path
    const originalUrl = req.url || '/';
    const qsStart = originalUrl.indexOf('?');
    const queryString = qsStart >= 0 ? originalUrl.slice(qsStart) : '';
    (req as any).url = '/_engine' + queryString;
    (io as any).engine.handleRequest(req, res);
    return;
  }

  // All other requests go to Express
  app(req as any, res as any);
});

// Handle WebSocket upgrade — always route to Socket.IO engine
httpServer.on('upgrade', (req, socket, head) => {
  // Rewrite URL to match Engine.IO's internal path
  const originalUrl = req.url || '/';
  const qsStart = originalUrl.indexOf('?');
  const queryString = qsStart >= 0 ? originalUrl.slice(qsStart) : '';
  (req as any).url = '/_engine' + queryString;
  (io as any).engine.handleUpgrade(req, socket, head);
});

// ====== START SERVER ======
httpServer.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  ASOJU FieldForce Chat Service                ║`);
  console.log(`║  Port: ${PORT}                                    ║`);
  console.log(`║  REST: /api/threads, /api/upload, /api/files  ║`);
  console.log(`║  Search: /api/search?q=...                     ║`);
  console.log(`║  Delete: DELETE /api/messages/:id              ║`);
  console.log(`║  WebSocket: Socket.IO on path '/' (Caddy)     ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);
});

// ====== GRACEFUL SHUTDOWN ======
function shutdown(signal: string) {
  console.log(`\n[SIGNAL] Received ${signal}, shutting down chat service...`);

  io.disconnectSockets(true);

  httpServer.close(() => {
    console.log('[SHUTDOWN] HTTP server closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('[SHUTDOWN] Forced exit after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
