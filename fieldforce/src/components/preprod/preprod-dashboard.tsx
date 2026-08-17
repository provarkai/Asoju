'use client';

import { useState, useMemo } from 'react';
import {
  AlertTriangle, CheckCircle2, XCircle, ShieldAlert, Server,
  Globe, Lock, Database, FileText, Truck, HardHat,
  ChevronDown, ChevronRight, Search, Filter, ArrowRight,
  CircleDot, TriangleAlert, Info, Wrench, Zap,
  CircleCheck, CircleX, Clock, Layers, Gauge, Eye,
  RotateCcw, LayoutDashboard, FileWarning, Siren,
  ArrowUpRight, AlertOctagon, Flame
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────

type Priority = 'P0_BLOCKER' | 'P1_HIGH' | 'P2_MEDIUM' | 'P3_LOW';
type Category = 'security' | 'infrastructure' | 'frontend' | 'devops' | 'data' | 'observability' | 'performance';

interface GapItem {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  category: Category;
  status: 'missing' | 'partial' | 'broken' | 'needs-fix';
  current: string;
  required: string;
  affectedFiles: string[];
  effort: 'quick' | 'medium' | 'large' | 'complex';
  impact: string;
  dependencies?: string[];
}

// ─── Data ───────────────────────────────────────────────────────────────

const CATEGORIES: { id: Category; label: string; icon: React.ElementType; color: string }[] = [
  { id: 'security', label: 'Security', icon: ShieldAlert, color: 'text-red-600' },
  { id: 'infrastructure', label: 'Infrastructure', icon: Server, color: 'text-amber-600' },
  { id: 'frontend', label: 'Frontend / UI', icon: Globe, color: 'text-sky-600' },
  { id: 'devops', label: 'DevOps / Deploy', icon: Truck, color: 'text-violet-600' },
  { id: 'data', label: 'Data / Database', icon: Database, color: 'text-emerald-600' },
  { id: 'observability', label: 'Observability', icon: Eye, color: 'text-teal-600' },
  { id: 'performance', label: 'Performance', icon: Gauge, color: 'text-orange-600' },
];

const PRIORITIES: { id: Priority; label: string; color: string; bg: string; border: string; icon: React.ElementType }[] = [
  { id: 'P0_BLOCKER', label: 'P0 Blocker', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', icon: XCircle },
  { id: 'P1_HIGH', label: 'P1 High', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', icon: AlertTriangle },
  { id: 'P2_MEDIUM', label: 'P2 Medium', color: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-200', icon: Info },
  { id: 'P3_LOW', label: 'P3 Low', color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200', icon: CircleDot },
];

const EFFORT_LABELS: Record<string, { label: string; color: string }> = {
  quick: { label: 'Quick', color: 'bg-emerald-100 text-emerald-700' },
  medium: { label: 'Medium', color: 'bg-amber-100 text-amber-700' },
  large: { label: 'Large', color: 'bg-orange-100 text-orange-700' },
  complex: { label: 'Complex', color: 'bg-red-100 text-red-700' },
};

const STATUS_STYLES: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  missing: { label: 'Missing', color: 'bg-red-100 text-red-700', icon: XCircle },
  partial: { label: 'Partial', color: 'bg-amber-100 text-amber-700', icon: AlertTriangle },
  broken: { label: 'Broken', color: 'bg-rose-100 text-rose-700', icon: Siren },
  'needs-fix': { label: 'Needs Fix', color: 'bg-orange-100 text-orange-700', icon: Wrench },
};

const GAPS: GapItem[] = [
  // ═══════════════ SECURITY ═══════════════
  {
    id: 'SEC-001',
    title: 'No Application Middleware',
    description: 'No Next.js middleware.ts exists. Auth checks, rate limiting, security headers, and request logging are not enforced globally. Auth is applied per-route via helper functions, but many routes lack proper auth guards.',
    priority: 'P0_BLOCKER',
    category: 'security',
    status: 'missing',
    current: 'Per-route auth via requireAdmin(), getAgentIdFromRequest(). No global enforcement.',
    required: 'Implement middleware.ts for: (1) route-level auth enforcement, (2) rate limiting per IP/token, (3) security headers (CSP, X-Frame-Options, etc.), (4) request correlation IDs, (5) bot/proxy detection.',
    affectedFiles: ['src/middleware.ts (create)', 'src/lib/auth.ts', 'src/lib/admin-auth.ts', 'src/lib/customer-auth.ts'],
    effort: 'large',
    impact: 'Unauthenticated requests can reach protected endpoints. No rate limiting = DoS vulnerability. No security headers = XSS/CSRF exposure.',
    dependencies: ['SEC-002'],
  },
  {
    id: 'SEC-002',
    title: 'Zero Input Validation on API Routes',
    description: 'All 58 API routes parse request bodies with raw `await request.json()` without any Zod validation. No schema enforcement on any endpoint — requests are trusted blindly.',
    priority: 'P0_BLOCKER',
    category: 'security',
    status: 'missing',
    current: 'Raw request.json() parsing everywhere. Zod is installed but never used in API routes (only in onboarding form UI).',
    required: 'Create Zod validation schemas for every API route. Implement a typed parseBody<T>(request, schema) utility. Validate query params, path params, and request bodies.',
    affectedFiles: ['src/app/api/**/*.ts (all 58 route files)', 'src/lib/validate.ts (create)'],
    effort: 'large',
    impact: 'SQL injection via malformed inputs, type confusion attacks, oversized payloads crashing server, malformed data in database.',
  },
  {
    id: 'SEC-003',
    title: 'JWT Secret Hardcoded Fallback',
    description: 'JWT_SECRET env var has a hardcoded fallback: "fallback-secret-change-in-production". If the env var is missing in production, all JWTs use this predictable secret — anyone can forge tokens.',
    priority: 'P0_BLOCKER',
    category: 'security',
    status: 'needs-fix',
    current: 'process.env.JWT_SECRET || "fallback-secret-change-in-production" in auth.ts, admin-auth.ts, customer-auth.ts.',
    required: 'Remove fallback. Fail startup if JWT_SECRET is not set. Use different secrets per portal namespace (JWT_SECRET, ADMIN_JWT_SECRET, CUSTOMER_JWT_SECRET).',
    affectedFiles: ['src/lib/auth.ts', 'src/lib/admin-auth.ts', 'src/lib/customer-auth.ts', '.env (create)'],
    effort: 'quick',
    impact: 'Complete authentication bypass — anyone can forge admin/agent/customer tokens.',
  },
  {
    id: 'SEC-004',
    title: 'CORS Wide Open',
    description: 'CORS is configured as origin: "*" on the Caddyfile and the chat-service. No origin whitelist or credential enforcement. Any domain can make cross-origin requests.',
    priority: 'P1_HIGH',
    category: 'security',
    status: 'needs-fix',
    current: 'Caddyfile: `origin *`. Chat service: `cors({ origin: "*" })`. No CORS on Next.js routes (Caddy handles it).',
    required: 'Configure allowed origins whitelist for each environment. Enable credentials mode. Restrict chat service CORS to ASOJU domains only.',
    affectedFiles: ['Caddyfile', 'mini-services/chat-service/index.ts'],
    effort: 'quick',
    impact: 'CSRF attacks from any domain. Malicious sites can trigger state-changing operations.',
  },
  {
    id: 'SEC-005',
    title: 'Security Headers Not Applied Globally',
    description: 'SECURITY_HEADERS constant is defined in bola.ts but manually applied to only 6 of 58 API routes. The remaining 52 routes have no security headers.',
    priority: 'P1_HIGH',
    category: 'security',
    status: 'partial',
    current: 'Headers defined in src/lib/bola.ts. Applied in: admin auth, integration routes. Missing from all other routes.',
    required: 'Move security headers to middleware.ts (global). Headers: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Content-Security-Policy, Permissions-Policy.',
    affectedFiles: ['src/lib/bola.ts', 'src/middleware.ts (create)'],
    effort: 'quick',
    impact: 'Clickjacking, XSS, MIME sniffing attacks possible on unprotected routes.',
    dependencies: ['SEC-001'],
  },
  {
    id: 'SEC-006',
    title: 'Admin & Customer Cookie Missing Secure Flag',
    description: 'Admin token cookie (admin_token) and Customer token cookie (cust_token) lack the `Secure` flag. They will be sent over unencrypted HTTP connections.',
    priority: 'P1_HIGH',
    category: 'security',
    status: 'needs-fix',
    current: 'Agent cookie: HttpOnly + Secure + SameSite=Strict. Admin cookie: HttpOnly + SameSite=Lax (no Secure). Customer cookie: HttpOnly + SameSite=Lax (no Secure).',
    required: 'Add `Secure` flag to all cookie set operations. Enforce HTTPS in Caddy configuration.',
    affectedFiles: ['src/lib/admin-auth.ts', 'src/lib/customer-auth.ts', 'Caddyfile'],
    effort: 'quick',
    impact: 'Token theft via man-in-the-middle attacks on HTTP connections.',
  },
  {
    id: 'SEC-007',
    title: 'No Rate Limiting',
    description: 'No application-level or infrastructure-level rate limiting exists. Login endpoints, API routes, and webhook handlers are all unthrottled.',
    priority: 'P1_HIGH',
    category: 'security',
    status: 'missing',
    current: 'No rate limiting anywhere. Login brute-force, API abuse, and DDoS attacks are unmitigated.',
    required: 'Implement rate limiting: (1) Login endpoint: 5 attempts/minute/IP, (2) API routes: 60 req/min/user, (3) Webhooks: 100 req/min, (4) Global: 1000 req/min/IP. Use in-memory token bucket with future Redis backup.',
    affectedFiles: ['src/lib/rate-limiter.ts (create)', 'src/middleware.ts (create)', 'src/lib/constants.ts'],
    effort: 'medium',
    impact: 'Brute-force login attacks, credential stuffing, API abuse, resource exhaustion.',
    dependencies: ['SEC-001'],
  },
  {
    id: 'SEC-008',
    title: 'Chat Service File Downloads Unauthenticated',
    description: 'GET /api/files/:filename in chat-service has no authentication check. Anyone with a URL can download any uploaded file.',
    priority: 'P1_HIGH',
    category: 'security',
    status: 'missing',
    current: 'No auth middleware on GET /api/files/:filename. JWT verification exists on other routes but not this one.',
    required: 'Add JWT verification to the file download endpoint. Implement signed URLs with expiry for file access. Consider storing files in cloud storage (S3) with presigned URLs.',
    affectedFiles: ['mini-services/chat-service/index.ts'],
    effort: 'quick',
    impact: 'Unauthorized access to all chat file attachments (photos, documents, evidence).',
  },
  {
    id: 'SEC-009',
    title: 'No Request Body Size Limits',
    description: 'API routes accept unlimited request body sizes. No body parser configuration limits payload size.',
    priority: 'P2_MEDIUM',
    category: 'security',
    status: 'missing',
    current: 'Next.js default (no limit). Evidence upload accepts up to 200MB but no server-side enforcement.',
    required: 'Configure body size limits in middleware. Standard routes: 1MB. Evidence upload: 200MB. Chat upload: 10MB.',
    affectedFiles: ['src/middleware.ts (create)', 'next.config.ts'],
    effort: 'quick',
    impact: 'Memory exhaustion attacks via oversized payloads.',
    dependencies: ['SEC-001'],
  },

  // ═══════════════ INFRASTRUCTURE ═══════════════
  {
    id: 'INFRA-001',
    title: 'No Error Boundaries',
    description: 'Missing error.tsx, not-found.tsx, loading.tsx, and global-error.tsx at the app level. Runtime errors will show Next.js default unstyled error pages.',
    priority: 'P0_BLOCKER',
    category: 'infrastructure',
    status: 'missing',
    current: 'No error handling pages. API routes return generic { error: "Internal server error" } with try/catch.',
    required: 'Create: (1) src/app/error.tsx — route error boundary, (2) src/app/not-found.tsx — custom 404, (3) src/app/loading.tsx — skeleton loading, (4) src/app/global-error.tsx — catch-all error UI.',
    affectedFiles: ['src/app/error.tsx (create)', 'src/app/not-found.tsx (create)', 'src/app/loading.tsx (create)', 'src/app/global-error.tsx (create)'],
    effort: 'quick',
    impact: 'Poor UX on errors. Unhandled exceptions show raw Next.js error pages to users.',
  },
  {
    id: 'INFRA-002',
    title: 'TypeScript Build Errors Suppressed',
    description: 'next.config.ts has `ignoreBuildErrors: true`. TypeScript type errors are silently ignored at build time — no type safety enforcement.',
    priority: 'P0_BLOCKER',
    category: 'infrastructure',
    status: 'needs-fix',
    current: 'typescript: { ignoreBuildErrors: true } in next.config.ts. Known issues include duplicate EvidenceStatus type.',
    required: 'Set ignoreBuildErrors to false. Fix all TypeScript errors. Remove duplicate type definitions. Enable strict mode in tsconfig.json.',
    affectedFiles: ['next.config.ts', 'tsconfig.json', 'src/lib/types.ts'],
    effort: 'medium',
    impact: 'Type safety is the last line of defense. Silent errors can cause runtime crashes in production.',
  },
  {
    id: 'INFRA-003',
    title: 'React Strict Mode Disabled',
    description: 'reactStrictMode is set to false in next.config.ts. Strict mode catches common bugs and warns about deprecated patterns.',
    priority: 'P2_MEDIUM',
    category: 'infrastructure',
    status: 'needs-fix',
    current: 'reactStrictMode: false in next.config.ts. Side effects not detected during development.',
    required: 'Enable reactStrictMode: true. Fix any warnings that appear (double rendering in dev, effect cleanup issues).',
    affectedFiles: ['next.config.ts'],
    effort: 'medium',
    impact: 'Hidden bugs from side effects, stale closures, and missing cleanup functions.',
  },
  {
    id: 'INFRA-004',
    title: 'No .env.example File',
    description: 'No documented list of required environment variables. New deployments have no reference for what needs to be configured.',
    priority: 'P1_HIGH',
    category: 'infrastructure',
    status: 'missing',
    current: '.env file exists with only DATABASE_URL. No documentation of required vars.',
    required: 'Create .env.example with: DATABASE_URL, JWT_SECRET, ADMIN_JWT_SECRET, CUSTOMER_JWT_SECRET, PAYSTACK_SECRET_KEY, PAYSTACK_WEBHOOK_SECRET, WHATSAPP_API_URL, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, ASOJU_API_KEY, ASOJU_HMAC_SECRET, APP_URL.',
    affectedFiles: ['.env.example (create)', 'src/lib/constants.ts'],
    effort: 'quick',
    impact: 'Deployment failures, misconfiguration, missing secrets in production.',
  },
  {
    id: 'INFRA-005',
    title: 'Background Workers Not Running',
    description: 'Outbox worker (src/lib/outbox.ts) and WhatsApp worker (src/lib/whatsapp-gateway.ts) are fully implemented but never started. No cron, no PM2 worker, no startup trigger.',
    priority: 'P1_HIGH',
    category: 'infrastructure',
    status: 'broken',
    current: 'startOutboxWorker() and startWhatsAppWorker() exist but are never called. Events pile up in PENDING state indefinitely.',
    required: 'Start workers in: (1) A dedicated mini-service (outbox-worker, port 3006), or (2) An API route triggered by cron, or (3) PM2 worker process. Add to startup sequence.',
    affectedFiles: ['src/lib/outbox.ts', 'src/lib/whatsapp-gateway.ts', 'mini-services/outbox-worker/ (create)'],
    effort: 'medium',
    impact: 'No event delivery. Webhooks never fire. WhatsApp messages never send. Dead-letter queue grows forever.',
  },
  {
    id: 'INFRA-006',
    title: 'No Containerization',
    description: 'No Dockerfile, docker-compose.yml, or container orchestration config. Production deployment relies on manual setup.',
    priority: 'P1_HIGH',
    category: 'infrastructure',
    status: 'missing',
    current: 'Build script copies .next/standalone. keep-alive.sh is a dev loop. No container images.',
    required: 'Create: (1) Dockerfile (multi-stage build), (2) docker-compose.yml (app + chat-service + outbox-worker + Caddy), (3) .dockerignore, (4) Health checks in Docker.',
    affectedFiles: ['Dockerfile (create)', 'docker-compose.yml (create)', '.dockerignore (create)'],
    effort: 'medium',
    impact: 'Inconsistent deployments, environment drift, no reproducible builds.',
  },

  // ═══════════════ FRONTEND ═══════════════
  {
    id: 'FE-001',
    title: 'Sonner Toasts Silent in Admin Panels',
    description: '7 admin panels import `toast from sonner` but the Sonner `<Toaster />` component is never mounted. Root layout mounts Radix Toaster instead. All toast calls are silently ignored.',
    priority: 'P0_BLOCKER',
    category: 'frontend',
    status: 'broken',
    current: 'Sonner calls in: finance-dashboard, trust-score-panel, care-plans-panel, sos-panel, outbox-panel, operations-panel, service-reports-panel. Sonner Toaster never mounted.',
    required: 'Either: (A) Add Sonner <Toaster /> to root layout and remove Radix Toaster, or (B) Replace all `toast from sonner` with Radix toast usage, or (C) Use Sonner exclusively everywhere.',
    affectedFiles: ['src/app/layout.tsx', 'src/components/admin/*.tsx (7 files)', 'src/components/ui/sonner.tsx'],
    effort: 'quick',
    impact: 'Admin actions (QC approve, payouts, SOS response) give zero feedback to user.',
  },
  {
    id: 'FE-002',
    title: 'No next/image Usage',
    description: 'Next.js Image component is never used. All images render via raw `<img>` tags with no optimization, lazy loading, or responsive sizing.',
    priority: 'P2_MEDIUM',
    category: 'frontend',
    status: 'missing',
    current: 'Raw <img> tags in: chat-window, evidence-capture, checklist-panel, kyc-step, support-chat. No lazy loading, no srcset, no blur placeholder.',
    required: 'Replace <img> with next/image <Image>. Configure remotePatterns in next.config.ts. Add placeholder="blur" for evidence photos. Use sizes prop for responsive images.',
    affectedFiles: ['next.config.ts', 'src/components/chat/chat-window.tsx', 'src/components/workspace/evidence-capture.tsx', 'src/components/workspace/checklist-panel.tsx', 'src/components/onboarding/kyc-step.tsx'],
    effort: 'medium',
    impact: 'Slow image loading, no responsive image serving, wasted bandwidth on mobile.',
  },
  {
    id: 'FE-003',
    title: 'TanStack Query Unused',
    description: '@tanstack/react-query is installed but never imported. No QueryClient, no QueryClientProvider, no useQuery/useMutation calls. All data fetching is raw fetch() in useEffect.',
    priority: 'P2_MEDIUM',
    category: 'frontend',
    status: 'missing',
    current: 'All data fetching via raw fetch() + useState. No caching, no background refetch, no optimistic updates, no retry logic.',
    required: 'Set up QueryClientProvider in layout. Migrate critical fetch calls to useQuery (missions, wallet, gigs). Add useMutation for state transitions, evidence upload, chat send.',
    affectedFiles: ['src/app/layout.tsx', 'src/providers/ (create)', 'src/lib/asoju-api.ts', 'src/hooks/'],
    effort: 'large',
    impact: 'No data caching, no offline data, no background refresh. Every tab switch re-fetches from server.',
  },
  {
    id: 'FE-004',
    title: 'Dark Mode Defined but Not Functional',
    description: 'Dark mode CSS variables exist in globals.css. next-themes is installed. But no ThemeProvider is mounted, no theme toggle UI exists, and sonner.tsx wrapper will crash if rendered.',
    priority: 'P3_LOW',
    category: 'frontend',
    status: 'broken',
    current: 'globals.css has .dark variants. next-themes installed but ThemeProvider not mounted. No toggle button.',
    required: 'Add ThemeProvider wrapper in layout.tsx. Add toggle button in header/admin nav. Fix sonner.tsx useTheme crash.',
    affectedFiles: ['src/app/layout.tsx', 'src/components/layout/header.tsx', 'src/components/ui/sonner.tsx'],
    effort: 'medium',
    impact: 'Dark mode UI is non-functional. Night-time usage for field agents is harder.',
  },
  {
    id: 'FE-005',
    title: 'i18n Package Installed but Unused',
    description: 'next-intl is installed but never configured. No locale files, no NextIntlClientProvider, no useTranslations calls. All text is hardcoded English.',
    priority: 'P3_LOW',
    category: 'frontend',
    status: 'missing',
    current: 'next-intl in package.json. No i18n config, no message files, no provider. html lang="en" hardcoded.',
    required: 'For Phase 1 (Nigeria-only): Remove if not needed. For Phase 2 (multi-language): Configure next-intl, create locale files (en, yo, ha, ig), add language switcher.',
    affectedFiles: ['src/i18n.ts (create)', 'src/messages/ (create)', 'src/app/layout.tsx'],
    effort: 'large',
    impact: 'Minor for Phase 1 (English-only). Major for Phase 2 if Nigerian languages needed.',
  },
  {
    id: 'FE-006',
    title: 'API URL Mismatch: Live Tracking',
    description: 'Admin live-tracking-panel fetches `/api/admin/live-tracking` but the actual route is at `/api/admin/tracking`. Requests will 404.',
    priority: 'P0_BLOCKER',
    category: 'frontend',
    status: 'broken',
    current: 'live-tracking-panel.tsx: fetch(`/api/admin/live-tracking?...`). Route exists at: src/app/api/admin/tracking/route.ts.',
    required: 'Fix URL to `/api/admin/tracking` in live-tracking-panel.tsx.',
    affectedFiles: ['src/components/admin/live-tracking-panel.tsx'],
    effort: 'quick',
    impact: 'Admin live tracking feature completely broken — 404 on every request.',
  },
  {
    id: 'FE-007',
    title: 'Chat Upload Route Missing',
    description: 'useChat hook fetches `/api/chat/upload` for file uploads but this BFF proxy route does not exist. File uploads will 404.',
    priority: 'P1_HIGH',
    category: 'frontend',
    status: 'broken',
    current: 'useChat hook line ~432: authFetch(`/api/chat/upload`, ...). No corresponding route under src/app/api/chat/upload/.',
    required: 'Create src/app/api/chat/upload/route.ts as BFF proxy to chat-service /api/upload. Forward file, headers, and auth.',
    affectedFiles: ['src/app/api/chat/upload/route.ts (create)', 'src/hooks/use-chat.ts'],
    effort: 'medium',
    impact: 'Chat file/image uploads completely non-functional.',
  },
  {
    id: 'FE-008',
    title: 'iOS Safe Area CSS Class Undefined',
    description: 'bottom-nav.tsx uses `safe-area-bottom` CSS class but it is not defined in globals.css. iOS PWA bottom bar will overlap navigation.',
    priority: 'P2_MEDIUM',
    category: 'frontend',
    status: 'needs-fix',
    current: 'className includes `safe-area-bottom` in bottom-nav.tsx. Not defined anywhere in CSS.',
    required: 'Define in globals.css: `.safe-area-bottom { padding-bottom: env(safe-area-inset-bottom, 0px); }`',
    affectedFiles: ['src/app/globals.css', 'src/components/layout/bottom-nav.tsx'],
    effort: 'quick',
    impact: 'iOS PWA bottom navigation partially obscured by system home indicator.',
  },
  {
    id: 'FE-009',
    title: 'No Accessibility Skip Link',
    description: 'No skip-to-content link anywhere. Keyboard/screen reader users must tab through entire navigation on every page.',
    priority: 'P3_LOW',
    category: 'frontend',
    status: 'missing',
    current: 'Some ARIA attributes exist (role="navigation", aria-label, sr-only). No skip link, no focus management on tab changes.',
    required: 'Add skip-to-content link as first focusable element in each portal shell. Add focus management for portal transitions and tab switches.',
    affectedFiles: ['src/components/layout/app-shell.tsx', 'src/components/admin/admin-shell.tsx', 'src/components/customer/customer-shell.tsx'],
    effort: 'quick',
    impact: 'WCAG 2.1 Level A failure (2.4.1 Bypass Blocks).',
  },

  // ═══════════════ DEVOPS ═══════════════
  {
    id: 'DEVOPS-001',
    title: 'Zero Test Coverage',
    description: 'No unit tests, integration tests, or E2E tests exist. No test framework configured. No test script in package.json.',
    priority: 'P1_HIGH',
    category: 'devops',
    status: 'missing',
    current: 'Only infrastructure test scripts exist (python-runtime-*.sh, database-runtime-build.sh). Zero application tests.',
    required: 'Install Vitest. Create test config. Write tests for: (1) Mission state machine, (2) GPS geofence validation, (3) Evidence custody, (4) Outbox pattern, (5) Integration gateway HMAC, (6) Auth token generation. Add CI test step.',
    affectedFiles: ['vitest.config.ts (create)', 'src/lib/__tests__/ (create)', 'package.json'],
    effort: 'large',
    impact: 'No regression safety. Every deployment is a leap of faith. Refactoring is risky.',
  },
  {
    id: 'DEVOPS-002',
    title: 'No Database Backup Strategy',
    description: 'SQLite database at db/custom.db has no automated backup. No backup scripts, no scheduled dumps, no restore procedures documented.',
    priority: 'P1_HIGH',
    category: 'devops',
    status: 'missing',
    current: 'Single SQLite file. No backup scripts, no cron backup jobs, no offsite backup.',
    required: 'Implement: (1) Hourly sqlite3 backup to secondary location, (2) Daily compressed backup to cloud storage, (3) Restore test procedure, (4) Backup monitoring/alerting.',
    affectedFiles: ['scripts/backup.sh (create)', 'scripts/restore.sh (create)'],
    effort: 'medium',
    impact: 'Database corruption or data loss = complete platform failure. No recovery path.',
  },
  {
    id: 'DEVOPS-003',
    title: 'No Structured Logging',
    description: 'All logging is console.log/console.error/console.warn. No structured JSON logs, no log levels, no correlation IDs, no log aggregation.',
    priority: 'P1_HIGH',
    category: 'devops',
    status: 'missing',
    current: 'Console logging everywhere. Prisma query logging enabled (logs all SQL to stdout). No request correlation.',
    required: 'Install pino (Bun-native). Create logger with: structured JSON output, correlation ID propagation, log levels (debug/info/warn/error), request/response logging in middleware.',
    affectedFiles: ['src/lib/logger.ts (create)', 'src/middleware.ts (create)', 'src/lib/db.ts'],
    effort: 'medium',
    impact: 'Cannot diagnose production issues. No audit trail. SQL queries potentially leak credentials.',
    dependencies: ['SEC-001'],
  },
  {
    id: 'DEVOPS-004',
    title: 'Prisma Query Logging in Production',
    description: 'Prisma is configured with log: ["query"] which logs ALL SQL queries to stdout. This will leak sensitive data and degrade performance in production.',
    priority: 'P1_HIGH',
    category: 'devops',
    status: 'needs-fix',
    current: 'log: ["query", "error", "warn"] in src/lib/db.ts. All queries logged including parameter values.',
    required: 'Configure conditional logging: log: ["error", "warn"] always, log: ["query"] only in development. Use event middleware for query logging in debug mode.',
    affectedFiles: ['src/lib/db.ts'],
    effort: 'quick',
    impact: 'Sensitive data (user info, financial data) logged to stdout. Performance degradation from excessive I/O.',
  },
  {
    id: 'DEVOPS-005',
    title: 'No Error Tracking / APM',
    description: 'No error tracking service (Sentry, Rollbar) or APM (Datadog, New Relic) integrated. Runtime errors are invisible in production.',
    priority: 'P2_MEDIUM',
    category: 'devops',
    status: 'missing',
    current: 'Console.error only. No error aggregation, no alerting, no performance monitoring.',
    required: 'Integrate error tracking (Sentry recommended): capture unhandled errors, track slow requests, monitor frontend JS errors, set up alerting rules.',
    affectedFiles: ['src/lib/sentry.ts (create)', 'src/app/layout.tsx', 'src/app/global-error.tsx'],
    effort: 'medium',
    impact: 'Production errors go unnoticed until users complain. No performance baseline.',
  },

  // ═══════════════ DATA / DATABASE ═══════════════
  {
    id: 'DATA-001',
    title: 'SQLite as Production Database',
    description: 'SQLite is used as the database. SQLite has no concurrent write support (only one writer at a time), no replication, no connection pooling, no horizontal scaling.',
    priority: 'P0_BLOCKER',
    category: 'data',
    status: 'needs-fix',
    current: 'SQLite at db/custom.db with WAL mode. Prisma SQLite provider. 55 models, 1567-line schema.',
    required: 'Migrate to PostgreSQL: (1) Update Prisma provider, (2) Adjust schema syntax, (3) Set up PostgreSQL instance, (4) Run data migration, (5) Update connection pooling, (6) Test all queries.',
    affectedFiles: ['prisma/schema.prisma', 'src/lib/db.ts', '.env', 'docker-compose.yml'],
    effort: 'complex',
    impact: 'Writer lock contention under load. No replication for HA. No concurrent connection support. Data loss risk.',
  },
  {
    id: 'DATA-002',
    title: 'No Migration History',
    description: 'Using `prisma db push --accept-data-loss` for schema changes. No migration files, no rollback capability, no schema version history.',
    priority: 'P1_HIGH',
    category: 'data',
    status: 'needs-fix',
    current: 'Script uses `--accept-data-loss` flag. No prisma/migrations/ directory. Schema changes are destructive and irreversible.',
    required: 'Switch to `prisma migrate dev` for development. Create baseline migration. All future schema changes go through migration files. Enable migration history.',
    affectedFiles: ['prisma/schema.prisma', 'prisma/migrations/ (create)', 'package.json'],
    effort: 'medium',
    impact: 'Cannot roll back schema changes. Data loss during schema updates. No audit trail of schema evolution.',
    dependencies: ['DATA-001'],
  },
  {
    id: 'DATA-003',
    title: 'No Database Seed Script',
    description: 'No seed data for development or staging. Fresh deployments start with empty databases — agents, tiers, service definitions must be manually created.',
    priority: 'P2_MEDIUM',
    category: 'data',
    status: 'missing',
    current: 'No seed.ts file. AgentTier records, ServiceDefinition records, and AdminUser records must be created manually.',
    required: 'Create prisma/seed.ts: seed AgentTiers (4 records), ServiceDefinitions (15 from catalog), sample AdminUser, sample IntegrationClient. Add `prisma db seed` script.',
    affectedFiles: ['prisma/seed.ts (create)', 'package.json'],
    effort: 'medium',
    impact: 'Every new environment requires manual data setup. Inconsistent dev/staging data.',
  },
  {
    id: 'DATA-004',
    title: 'File Storage on Local Disk Only',
    description: 'Evidence files, chat uploads, and documents are stored on local disk. No cloud storage, no CDN, no redundancy. Server restart can lose files.',
    priority: 'P1_HIGH',
    category: 'data',
    status: 'missing',
    current: 'Evidence: local disk (storageProvider: "LOCAL"). Chat uploads: mini-services/chat-service/uploads/. No cloud integration.',
    required: 'Migrate to S3-compatible storage (AWS S3, Cloudflare R2, or Wasabi): (1) Install @aws-sdk/client-s3, (2) Create storage abstraction layer, (3) Implement signed URL generation, (4) Migrate existing files.',
    affectedFiles: ['src/lib/storage.ts (create)', 'src/lib/evidence-custody.ts', 'mini-services/chat-service/index.ts', '.env'],
    effort: 'large',
    impact: 'Data loss on server crash. No CDN = slow media loading. No geographic redundancy.',
  },
  {
    id: 'DATA-005',
    title: 'Duplicate EvidenceStatus Type Definition',
    description: 'EvidenceStatus is defined twice in types.ts with conflicting values (lines 57-66 and 584-587). Build errors are suppressed so this conflict is invisible.',
    priority: 'P2_MEDIUM',
    category: 'data',
    status: 'broken',
    current: 'First definition: CAPTURED, QUEUED, UPLOADING, UPLOADED, VALIDATING, VALIDATED, AVAILABLE. Second: CAPTURED, UPLOADED, VERIFIED, QUARANTINED, QC_REVIEWED, ACCEPTED, REJECTED, ARCHIVED.',
    required: 'Keep only the custody-aware version (second). Update all references to use the correct values. This is a blocker for fixing ignoreBuildErrors.',
    affectedFiles: ['src/lib/types.ts'],
    effort: 'quick',
    impact: 'Type confusion. Some code uses one enum, other code uses the other. Silent failures.',
    dependencies: ['INFRA-002'],
  },

  // ═══════════════ OBSERVABILITY ═══════════════
  {
    id: 'OBS-001',
    title: 'No Request Correlation IDs',
    description: 'No correlation IDs are generated for requests. Tracing a request across API routes, outbox events, and mini-services is impossible.',
    priority: 'P2_MEDIUM',
    category: 'observability',
    status: 'missing',
    current: 'Outbox messages have a correlationId field but it is never populated by incoming requests. No X-Request-ID headers.',
    required: 'Generate UUID correlation ID per request in middleware. Propagate via X-Request-ID header. Include in outbox events, log entries, and cross-service calls.',
    affectedFiles: ['src/middleware.ts (create)', 'src/lib/outbox.ts', 'src/hooks/use-chat.ts'],
    effort: 'medium',
    impact: 'Cannot trace requests across system boundaries. Debugging distributed issues is guesswork.',
    dependencies: ['SEC-001'],
  },
  {
    id: 'OBS-002',
    title: 'Health Probes Not Surfaced to Orchestrator',
    description: '/api/health and /api/health/ready exist but are not connected to Caddy health checks or container orchestration health probes.',
    priority: 'P2_MEDIUM',
    category: 'observability',
    status: 'partial',
    current: '3 health endpoints exist (liveness, readiness, dependencies). Caddy does not proxy health. Docker containers have no HEALTHCHECK.',
    required: 'Add health_check to Caddyfile. Add HEALTHCHECK to Dockerfile. Configure orchestration health probes. Wire alerts for readiness failures.',
    affectedFiles: ['Caddyfile', 'Dockerfile (create)'],
    effort: 'quick',
    impact: 'Orchestrator cannot detect unhealthy instances. Auto-restart/healing does not work.',
    dependencies: ['INFRA-006'],
  },

  // ═══════════════ PERFORMANCE ═══════════════
  {
    id: 'PERF-001',
    title: 'No Response Caching Strategy',
    description: 'No caching layer exists. Every API request hits the database directly. Reference data (tiers, service catalog, LGAs) is re-queried every time.',
    priority: 'P2_MEDIUM',
    category: 'performance',
    status: 'missing',
    current: 'Direct Prisma queries on every request. No in-memory cache, no Redis, no HTTP cache headers. Reference data fetched fresh every time.',
    required: 'Implement: (1) In-memory LRU cache for reference data (tiers, services, LGAs) with TTL, (2) HTTP Cache-Control headers on GET endpoints, (3) TanStack Query caching on frontend.',
    affectedFiles: ['src/lib/cache.ts (create)', 'src/app/api/**/*.ts'],
    effort: 'medium',
    impact: 'Unnecessary database load. Slower response times for reference data. Higher infrastructure costs at scale.',
  },
  {
    id: 'PERF-002',
    title: 'Dead Code / Unused Files',
    description: 'app-main.tsx is a dead duplicate of stateful-app.tsx. tailwind.config.ts is a vestigial v3 config conflicting with Tailwind v4. TanStack Query and next-intl are installed but unused.',
    priority: 'P3_LOW',
    category: 'performance',
    status: 'needs-fix',
    current: 'app-main.tsx (unused duplicate). tailwind.config.ts (vestigial v3). @tanstack/react-query (unused). next-intl (unused).',
    required: 'Delete app-main.tsx. Remove or update tailwind.config.ts. Either use or uninstall @tanstack/react-query and next-intl to reduce bundle size.',
    affectedFiles: ['src/app/app-main.tsx (delete)', 'tailwind.config.ts', 'package.json'],
    effort: 'quick',
    impact: 'Slightly increased bundle size. Codebase confusion for new developers.',
  },
];

// ─── Summary Computation ───────────────────────────────────────────────

function computeSummary() {
  const byPriority = {
    P0_BLOCKER: GAPS.filter(g => g.priority === 'P0_BLOCKER').length,
    P1_HIGH: GAPS.filter(g => g.priority === 'P1_HIGH').length,
    P2_MEDIUM: GAPS.filter(g => g.priority === 'P2_MEDIUM').length,
    P3_LOW: GAPS.filter(g => g.priority === 'P3_LOW').length,
  };
  const total = GAPS.length;
  const blockers = byPriority.P0_BLOCKER;
  const readinessScore = Math.max(0, Math.round(((total - blockers * 10 - byPriority.P1_HIGH * 3 - byPriority.P2_MEDIUM) / total) * 100));
  return { byPriority, total, blockers, readinessScore };
}

const SUMMARY = computeSummary();

// ─── Exported Component ────────────────────────────────────────────────

export function PreProdDashboard({ onBack }: { onBack: () => void }) {
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  const filteredGaps = useMemo(() => {
    return GAPS.filter(gap => {
      const matchesSearch = search === '' ||
        gap.title.toLowerCase().includes(search.toLowerCase()) ||
        gap.description.toLowerCase().includes(search.toLowerCase()) ||
        gap.id.toLowerCase().includes(search.toLowerCase());
      const matchesPriority = priorityFilter === 'all' || gap.priority === priorityFilter;
      const matchesCategory = categoryFilter === 'all' || gap.category === categoryFilter;
      return matchesSearch && matchesPriority && matchesCategory;
    });
  }, [search, priorityFilter, categoryFilter]);

  const filteredCounts = useMemo(() => ({
    total: filteredGaps.length,
    p0: filteredGaps.filter(g => g.priority === 'P0_BLOCKER').length,
    p1: filteredGaps.filter(g => g.priority === 'P1_HIGH').length,
    p2: filteredGaps.filter(g => g.priority === 'P2_MEDIUM').length,
    p3: filteredGaps.filter(g => g.priority === 'P3_LOW').length,
  }), [filteredGaps]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex flex-col">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                <HardHat className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-foreground">Pre-Production Readiness Audit</h1>
                <p className="text-xs sm:text-sm text-muted-foreground">ASOJU FieldForce v4.0 — Gap Analysis & Scoping</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="text-xs">
                {SUMMARY.total} Items
              </Badge>
              <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">
                {SUMMARY.blockers} Blockers
              </Badge>
              <Button variant="outline" size="sm" onClick={onBack} className="gap-2">
                <ArrowRight className="w-4 h-4 rotate-180" />
                <span className="hidden sm:inline">Back</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 py-6 w-full">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
          </TabsList>

          {/* ═══ OVERVIEW TAB ═══ */}
          <TabsContent value="overview" className="space-y-6">
            {/* Readiness Score */}
            <Card className="border-2">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <Gauge className="w-5 h-5 text-amber-500" />
                  Production Readiness Score
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-8">
                  <div className="relative w-32 h-32 flex-shrink-0">
                    <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
                      <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" className="text-muted/30" strokeWidth="8" />
                      <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor"
                        className={cn(
                          SUMMARY.readinessScore >= 80 ? 'text-emerald-500' :
                          SUMMARY.readinessScore >= 60 ? 'text-amber-500' :
                          SUMMARY.readinessScore >= 40 ? 'text-orange-500' : 'text-red-500'
                        )}
                        strokeWidth="8"
                        strokeDasharray={`${(SUMMARY.readinessScore / 100) * 327} 327`}
                        strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-3xl font-bold text-foreground">{SUMMARY.readinessScore}%</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-3 w-full">
                    <p className="text-sm text-muted-foreground">
                      Based on {SUMMARY.total} identified gaps across 7 categories. Score penalizes P0 blockers heavily and accounts for effort required.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {PRIORITIES.map(p => (
                        <div key={p.id} className={cn('rounded-lg border p-3 text-center', p.bg, p.border)}>
                          <p className={cn('text-2xl font-bold', p.color)}>{SUMMARY.byPriority[p.id as Priority]}</p>
                          <p className={cn('text-xs font-medium', p.color)}>{p.label.split(' ')[1]}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Category Breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {CATEGORIES.map(cat => {
                const catGaps = GAPS.filter(g => g.category === cat.id);
                const catBlockers = catGaps.filter(g => g.priority === 'P0_BLOCKER').length;
                const catHigh = catGaps.filter(g => g.priority === 'P1_HIGH').length;
                const catScore = catGaps.length > 0
                  ? Math.max(0, Math.round(((catGaps.length - catBlockers * 10 - catHigh * 3) / catGaps.length) * 100))
                  : 100;
                const CatIcon = cat.icon;
                return (
                  <Card key={cat.id} className="hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => { setCategoryFilter(cat.id); setActiveTab('details'); }}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <CatIcon className={cn('w-4 h-4', cat.color)} />
                          {cat.label}
                        </CardTitle>
                        <span className="text-xs text-muted-foreground">{catGaps.length}</span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Category Score</span>
                        <span className={cn('font-semibold', catScore >= 70 ? 'text-emerald-600' : catScore >= 40 ? 'text-amber-600' : 'text-red-600')}>
                          {catScore}%
                        </span>
                      </div>
                      <Progress value={catScore}
                        className={cn('h-2',
                          catScore >= 70 ? '[&>div]:bg-emerald-500' :
                          catScore >= 40 ? '[&>div]:bg-amber-500' : '[&>div]:bg-red-500'
                        )} />
                      <div className="flex gap-2 mt-2">
                        {catBlockers > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{catBlockers} P0</Badge>}
                        {catHigh > 0 && <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700">{catHigh} P1</Badge>}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Key Insights */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-amber-500" />
                  Key Insights
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-red-700 flex items-center gap-2">
                      <Flame className="w-4 h-4" /> Critical Findings
                    </h3>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li className="flex items-start gap-2">
                        <AlertOctagon className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                        <span><strong>7 P0 Blockers</strong> must be resolved before any production deployment. These include security vulnerabilities (JWT, no middleware, no validation) and broken features (toasts, tracking URL).</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <AlertOctagon className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                        <span><strong>SQLite as production DB</strong> — single-writer lock means concurrent agent check-ins and uploads will serialize. Must migrate to PostgreSQL.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <AlertOctagon className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                        <span><strong>Outbox worker never started</strong> — all 20+ event types accumulate in PENDING state. Webhooks, notifications, and WhatsApp messages never delivered.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <AlertOctagon className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                        <span><strong>Zero input validation</strong> — all 58 API routes accept raw JSON with no Zod schemas. Injection and type confusion attacks are trivially possible.</span>
                      </li>
                    </ul>
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-emerald-700 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" /> What&apos;s Working Well
                    </h3>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li className="flex items-start gap-2">
                        <CircleCheck className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span><strong>55-table Prisma schema</strong> — comprehensive domain model with agent tiers, missions, wallets, ledger, QC, evidence custody, outbox, integration gateway.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CircleCheck className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span><strong>BOLA/IDOR protection</strong> — mission, payout, evidence, and case ownership verification. Role-based access control for admin.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CircleCheck className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span><strong>Integration gateway</strong> — HMAC-SHA256 auth, timestamp freshness, nonce replay protection. Production-grade API security.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CircleCheck className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span><strong>Health probes</strong> — liveness, readiness, dependency health with circuit breaker status. Ready for container orchestration.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CircleCheck className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span><strong>3-portal architecture</strong> — Agent PWA, Admin Dashboard, Customer Portal, all with code-split lazy loading and responsive design.</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ DETAILS TAB ═══ */}
          <TabsContent value="details" className="space-y-4">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search gaps by ID, title, or description..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="w-[140px]">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priorities</SelectItem>
                  {PRIORITIES.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[160px]">
                  <Layers className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Filter counts */}
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span>{filteredCounts.total} results</span>
              <span className="text-red-600">{filteredCounts.p0} P0</span>
              <span className="text-amber-600">{filteredCounts.p1} P1</span>
              <span className="text-sky-600">{filteredCounts.p2} P2</span>
              <span className="text-slate-500">{filteredCounts.p3} P3</span>
            </div>

            {/* Gap Cards */}
            <div className="space-y-3">
              {filteredGaps.map(gap => {
                const priority = PRIORITIES.find(p => p.id === gap.priority)!;
                const category = CATEGORIES.find(c => c.id === gap.category)!;
                const statusStyle = STATUS_STYLES[gap.status];
                const effortStyle = EFFORT_LABELS[gap.effort];
                const StatusIcon = statusStyle.icon;
                const PriorityIcon = priority.icon;
                const isExpanded = expandedId === gap.id;

                return (
                  <Card key={gap.id}
                    className={cn('transition-all duration-200 hover:shadow-md', priority.border,
                      isExpanded ? 'ring-2 ring-primary/20' : ''
                    )}>
                    <button
                      className="w-full text-left p-4 sm:p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
                      onClick={() => setExpandedId(isExpanded ? null : gap.id)}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-0.5">
                          {isExpanded ? <ChevronDown className="w-5 h-5 text-muted-foreground" /> : <ChevronRight className="w-5 h-5 text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-[10px] font-mono">{gap.id}</Badge>
                            <PriorityIcon className={cn('w-3.5 h-3.5', priority.color)} />
                            <h3 className="text-sm font-semibold text-foreground">{gap.title}</h3>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <Badge variant="outline" className={cn('text-[10px]', priority.bg, priority.border, priority.color)}>
                              {priority.label}
                            </Badge>
                            <Badge variant="outline" className={cn('text-[10px]', statusStyle.color)}>
                              <StatusIcon className="w-3 h-3 mr-1" />
                              {statusStyle.label}
                            </Badge>
                            <Badge variant="outline" className={cn('text-[10px]', category.color)}>
                              {category.label}
                            </Badge>
                            <Badge variant="outline" className={cn('text-[10px]', effortStyle.color)}>
                              <Clock className="w-3 h-3 mr-1" />
                              {effortStyle.label}
                            </Badge>
                          </div>
                          {!isExpanded && (
                            <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{gap.description}</p>
                          )}
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 sm:px-5 pb-5 border-t">
                        <div className="pt-4 space-y-4">
                          <p className="text-sm text-muted-foreground leading-relaxed">{gap.description}</p>
                          <Separator />
                          <div className="space-y-1">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                              <CircleX className="w-3.5 h-3.5 text-red-500" /> Current State
                            </h4>
                            <p className="text-sm text-foreground bg-red-50 border border-red-100 rounded-lg p-3">{gap.current}</p>
                          </div>
                          <div className="space-y-1">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                              <CircleCheck className="w-3.5 h-3.5 text-emerald-500" /> Required Action
                            </h4>
                            <p className="text-sm text-foreground bg-emerald-50 border border-emerald-100 rounded-lg p-3">{gap.required}</p>
                          </div>
                          <div className="space-y-1">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                              <TriangleAlert className="w-3.5 h-3.5 text-amber-500" /> Impact if Unresolved
                            </h4>
                            <p className="text-sm text-foreground bg-amber-50 border border-amber-100 rounded-lg p-3">{gap.impact}</p>
                          </div>
                          <div className="space-y-1">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                              <FileWarning className="w-3.5 h-3.5" /> Affected Files
                            </h4>
                            <div className="flex flex-wrap gap-1.5">
                              {gap.affectedFiles.map(file => (
                                <Badge key={file} variant="outline" className="text-[10px] font-mono">{file}</Badge>
                              ))}
                            </div>
                          </div>
                          {gap.dependencies && gap.dependencies.length > 0 && (
                            <div className="space-y-1">
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                <RotateCcw className="w-3.5 h-3.5" /> Dependencies
                              </h4>
                              <div className="flex flex-wrap gap-1.5">
                                {gap.dependencies.map(dep => (
                                  <Badge key={dep} variant="secondary" className="text-[10px] font-mono cursor-pointer hover:bg-primary hover:text-primary-foreground"
                                    onClick={() => { setExpandedId(dep); setActiveTab('details'); }}>
                                    {dep}
                                    <ArrowUpRight className="w-3 h-3 ml-1" />
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>

            {filteredGaps.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No gaps match your filters.</p>
              </div>
            )}
          </TabsContent>

          {/* ═══ ROADMAP TAB ═══ */}
          <TabsContent value="roadmap" className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <RotateCcw className="w-5 h-5 text-violet-500" />
                  Recommended Execution Order
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-6">
                  Gaps are ordered by dependency chain and priority. Items in the same phase can be parallelized. Total estimated effort: 3–4 weeks with a senior developer.
                </p>

                <div className="space-y-6">
                  {/* Phase 1 */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                        <span className="text-sm font-bold text-red-700">1</span>
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">Phase 1 — P0 Blockers & Security Foundation</h3>
                        <p className="text-xs text-muted-foreground">Week 1 — Must complete before any production consideration</p>
                      </div>
                    </div>
                    <div className="ml-11 space-y-2">
                      {['SEC-001', 'SEC-002', 'SEC-003', 'INFRA-001', 'INFRA-002', 'FE-001', 'FE-006'].map(id => {
                        const gap = GAPS.find(g => g.id === id)!;
                        return (
                          <div key={id} className="flex items-center gap-2 text-sm cursor-pointer hover:underline"
                            onClick={() => { setExpandedId(id); setPriorityFilter('all'); setCategoryFilter('all'); setSearch(''); setActiveTab('details'); }}>
                            <Badge variant="outline" className="text-[10px] font-mono">{id}</Badge>
                            <span className="text-foreground">{gap.title}</span>
                            <Badge variant="outline" className={cn('text-[10px] ml-auto', EFFORT_LABELS[gap.effort].color)}>
                              {EFFORT_LABELS[gap.effort].label}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Phase 2 */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                        <span className="text-sm font-bold text-amber-700">2</span>
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">Phase 2 — Infrastructure & Reliability</h3>
                        <p className="text-xs text-muted-foreground">Week 2 — Env hardening, workers, logging, backup</p>
                      </div>
                    </div>
                    <div className="ml-11 space-y-2">
                      {['INFRA-004', 'INFRA-005', 'INFRA-006', 'SEC-004', 'SEC-006', 'SEC-007', 'SEC-008', 'SEC-009', 'SEC-005', 'DEVOPS-003', 'DEVOPS-004'].map(id => {
                        const gap = GAPS.find(g => g.id === id)!;
                        return (
                          <div key={id} className="flex items-center gap-2 text-sm cursor-pointer hover:underline"
                            onClick={() => { setExpandedId(id); setPriorityFilter('all'); setCategoryFilter('all'); setSearch(''); setActiveTab('details'); }}>
                            <Badge variant="outline" className="text-[10px] font-mono">{id}</Badge>
                            <span className="text-foreground">{gap.title}</span>
                            <Badge variant="outline" className={cn('text-[10px] ml-auto', EFFORT_LABELS[gap.effort].color)}>
                              {EFFORT_LABELS[gap.effort].label}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Phase 3 */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center">
                        <span className="text-sm font-bold text-sky-700">3</span>
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">Phase 3 — Data Layer & Storage</h3>
                        <p className="text-xs text-muted-foreground">Week 3 — PostgreSQL migration, cloud storage, backup</p>
                      </div>
                    </div>
                    <div className="ml-11 space-y-2">
                      {['DATA-001', 'DATA-002', 'DATA-004', 'DATA-003', 'DATA-005', 'DEVOPS-002'].map(id => {
                        const gap = GAPS.find(g => g.id === id)!;
                        return (
                          <div key={id} className="flex items-center gap-2 text-sm cursor-pointer hover:underline"
                            onClick={() => { setExpandedId(id); setPriorityFilter('all'); setCategoryFilter('all'); setSearch(''); setActiveTab('details'); }}>
                            <Badge variant="outline" className="text-[10px] font-mono">{id}</Badge>
                            <span className="text-foreground">{gap.title}</span>
                            <Badge variant="outline" className={cn('text-[10px] ml-auto', EFFORT_LABELS[gap.effort].color)}>
                              {EFFORT_LABELS[gap.effort].label}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Phase 4 */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
                        <span className="text-sm font-bold text-violet-700">4</span>
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">Phase 4 — Frontend Polish & Observability</h3>
                        <p className="text-xs text-muted-foreground">Week 3–4 — Fix broken UI, add caching, error tracking, tests</p>
                      </div>
                    </div>
                    <div className="ml-11 space-y-2">
                      {['FE-002', 'FE-003', 'FE-007', 'FE-008', 'INFRA-003', 'DEVOPS-001', 'DEVOPS-005', 'OBS-001', 'OBS-002', 'PERF-001'].map(id => {
                        const gap = GAPS.find(g => g.id === id)!;
                        return (
                          <div key={id} className="flex items-center gap-2 text-sm cursor-pointer hover:underline"
                            onClick={() => { setExpandedId(id); setPriorityFilter('all'); setCategoryFilter('all'); setSearch(''); setActiveTab('details'); }}>
                            <Badge variant="outline" className="text-[10px] font-mono">{id}</Badge>
                            <span className="text-foreground">{gap.title}</span>
                            <Badge variant="outline" className={cn('text-[10px] ml-auto', EFFORT_LABELS[gap.effort].color)}>
                              {EFFORT_LABELS[gap.effort].label}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Phase 5 */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                        <span className="text-sm font-bold text-slate-600">5</span>
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">Phase 5 — Nice-to-Haves & Cleanup</h3>
                        <p className="text-xs text-muted-foreground">Week 4+ — Polish, accessibility, dark mode, i18n</p>
                      </div>
                    </div>
                    <div className="ml-11 space-y-2">
                      {['FE-004', 'FE-005', 'FE-009', 'PERF-002'].map(id => {
                        const gap = GAPS.find(g => g.id === id)!;
                        return (
                          <div key={id} className="flex items-center gap-2 text-sm cursor-pointer hover:underline"
                            onClick={() => { setExpandedId(id); setPriorityFilter('all'); setCategoryFilter('all'); setSearch(''); setActiveTab('details'); }}>
                            <Badge variant="outline" className="text-[10px] font-mono">{id}</Badge>
                            <span className="text-foreground">{gap.title}</span>
                            <Badge variant="outline" className={cn('text-[10px] ml-auto', EFFORT_LABELS[gap.effort].color)}>
                              {EFFORT_LABELS[gap.effort].label}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Effort Summary */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <LayoutDashboard className="w-5 h-5 text-sky-500" />
                  Effort Estimation Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {Object.entries(EFFORT_LABELS).map(([key, val]) => {
                    const count = GAPS.filter(g => g.effort === key).length;
                    const duration = key === 'quick' ? '30min–2h' : key === 'medium' ? '2h–1d' : key === 'large' ? '1–3d' : '3–7d';
                    return (
                      <div key={key} className="text-center space-y-1">
                        <div className={cn('inline-flex items-center justify-center w-10 h-10 rounded-lg text-lg font-bold', val.color)}>
                          {count}
                        </div>
                        <p className="text-xs font-medium text-foreground">{val.label}</p>
                        <p className="text-[10px] text-muted-foreground">~{duration} each</p>
                      </div>
                    );
                  })}
                </div>
                <Separator className="my-4" />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total Estimated Timeline</span>
                  <span className="font-semibold text-foreground">3–4 weeks (1 senior dev)</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t bg-white mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} ASOJU FieldForce — Pre-Production Audit</p>
            <div className="flex items-center gap-4">
              <span>Generated: {new Date().toLocaleDateString('en-NG', { dateStyle: 'medium' })}</span>
              <span>&bull;</span>
              <span>v4.0.0</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
