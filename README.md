# ASOJU

**Your trusted presence back home.**

ASOJU is a diaspora support and trusted execution platform helping Nigerians abroad verify, manage,
and execute important tasks in Nigeria without being physically present. See
[`docs/ASOJU_Master_PRD_Build_Spec.md`](docs/ASOJU_Master_PRD_Build_Spec.md) for the full product spec —
every module in this repo is built directly against it.

## Repository layout

```
/backend    NestJS + Prisma + PostgreSQL — Case Engine, Trust & Evidence Engine, AI orchestration
/frontend   Next.js — customer portal (Web/PWA)
/docs       Product requirements documents
```

This is a modular monolith per the PRD's build philosophy (Section 11.1) — not microservices.

## What's built so far

All seven vertical slices of the golden path (PRD Section 11.3) are implemented and verified
end-to-end against a real Postgres instance:

**Request → Case**
- Core data model (Prisma schema, `backend/prisma/schema.prisma`) covering the full canonical shape
  from PRD Section 3.
- Self-rolled JWT auth with role-based + **case-scoped** access control (Non-Negotiable #6 — role
  membership alone is never enough to see a specific case).
- The deterministic Case Engine: `ServiceRequest` → triage → `ServiceCase`, with the Section 5.2 state
  machine enforced entirely in the backend, full status-history and append-only audit logging on every
  transition.
- The AI Diaspora Concierge (Section 7): tool-based structured output (the LLM never writes to the
  database directly), deterministic lead scoring in plain code, and conversation logging.

**Case → Quote → Payment**
- Staff issue a `Quote` on a case under review (`UNDER_REVIEW` → `QUOTED`); the customer accepts it,
  creating an `Invoice` (→ `AWAITING_PAYMENT`).
- Payment status changes **only** via a provider-webhook endpoint guarded by a shared secret
  (Non-Negotiable #4 — never a customer-facing screenshot) — verified webhook → `SCHEDULED`, and the
  case-status-history correctly attributes that transition to `system`, not a fake user.

**Payment → Assignment → Field Execution**
- Staff assign a verified field agent/provider to a `SCHEDULED` case (→ `ASSIGNED`); the assignee
  accepts (→ `IN_PROGRESS`) or declines (case reopens to `SCHEDULED` for reassignment).
- The agent/provider submits `Evidence` (photo/video/doc/note, referencing a private object-storage
  key, never a predictable public URL) and marks fieldwork complete (→ `EVIDENCE_SUBMITTED`).

**Evidence → QC → Report → Completion**
- QC reviews and either approves (creates the customer-facing `Report`, → `CUSTOMER_REVIEW`), sends
  the case back for rework (→ `IN_PROGRESS`), or escalates/flags an incident without silently
  advancing the case (Section 8.5 — "a field submission is never automatically a completed case").
- The customer approves from the case detail page (→ `APPROVED` → auto-`COMPLETED`); closing
  (`COMPLETED` → `CLOSED`) stays a deliberate staff/finance action.

**Customer portal P0 screens** (Section 5.1): registration/login, the natural-language AI Concierge
request entry point, case dashboard, and case detail with human-readable status, timeline, quote/accept,
evidence/report viewers, and approval actions.

Everything else in the PRD (Operations Control Centre UI, Field Agent App UI, Provider Portal UI,
WhatsApp integration, a real payment-provider integration, etc.) is scoped but not yet built — the
backend APIs for staff/agent actions exist (see route list below) but have no dedicated frontend yet.
See the PRD's phased roadmap (Section 11.4) and feature priorities (Section 12) for what comes next.

## Running locally

### 1. Infrastructure

```bash
docker compose up -d   # Postgres + Redis
cp .env.example backend/.env
```

Fill in `backend/.env` — at minimum `DATABASE_URL` (defaults match `docker-compose.yml`) and, to use the
AI Concierge, `ANTHROPIC_API_KEY`.

### 2. Install & migrate

```bash
npm install
npm run prisma:migrate --workspace=backend
```

### 3. Run

```bash
npm run dev:backend    # http://localhost:3001/api
npm run dev:frontend   # http://localhost:3000
```

Set `frontend/.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:3001` if you change the backend port.

### Notes

- Staff/agent/provider accounts are not self-service — `POST /api/auth/register` only creates
  `CUSTOMER` accounts (Section 5.1 progressive-disclosure onboarding). Provision staff directly via
  Prisma/psql until the Admin Console (Section 5.7) exists.
- The AI Concierge endpoint (`POST /api/ai/concierge/message`) requires `ANTHROPIC_API_KEY` to be set;
  without it, it fails closed rather than silently degrading.
- The payment webhook (`POST /api/payments/webhook`) requires an `x-webhook-secret` header matching
  `PAYMENT_WEBHOOK_SECRET` — a stand-in for real Paystack/Flutterwave signature verification.
- A staff member needs to be an explicit `CaseCollaborator` on a case to act on it (not just hold the
  right role) — triaging a request auto-attaches the triaging staff member; use
  `POST /api/cases/:caseId/collaborators` (admin-only) to attach anyone else (e.g. QC) to a case.

### Staff/agent-facing API routes (no dedicated frontend yet)

| Route | Who | What |
|---|---|---|
| `POST /api/service-requests/:id/convert` | Case Manager/RM/Admin | Triage a request into a case |
| `POST /api/cases/:caseId/transition` | Case Manager/QC/Admin | Manual state-machine transition |
| `POST /api/cases/:caseId/collaborators` | Admin | Attach staff to a case |
| `POST /api/cases/:caseId/quotes` | Case Manager/Finance/Admin | Issue a quote |
| `POST /api/quotes/:id/accept` | Customer | Accept a quote → invoice |
| `POST /api/payments/webhook` | Payment provider | Verify a payment |
| `POST /api/cases/:caseId/assignments` | Case Manager/Admin | Assign an agent/provider |
| `POST /api/assignments/:id/accept` \| `/decline` | Agent/Provider | Respond to an assignment |
| `POST /api/cases/:caseId/evidence` | Agent/Provider | Submit evidence |
| `POST /api/cases/:caseId/evidence/complete` | Agent/Provider | Mark fieldwork done |
| `POST /api/cases/:caseId/qc` | QC/Admin | Approve (issues report) / rework / escalate |
