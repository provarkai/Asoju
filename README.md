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

**Vertical slice 1 — Request → Case** (PRD Section 11.3) is implemented end-to-end:

- Core data model (Prisma schema, `backend/prisma/schema.prisma`) covering the full canonical shape
  from PRD Section 3.
- Self-rolled JWT auth with role-based + **case-scoped** access control (Non-Negotiable #6 — role
  membership alone is never enough to see a specific case).
- The deterministic Case Engine: `ServiceRequest` → triage → `ServiceCase`, with the Section 5.2 state
  machine enforced entirely in the backend, full status-history and append-only audit logging on every
  transition.
- The AI Diaspora Concierge (Section 7): tool-based structured output (the LLM never writes to the
  database directly), deterministic lead scoring in plain code, and conversation logging.
- Customer portal P0 screens (Section 5.1): registration/login, the natural-language request entry
  point, case dashboard, and case detail with human-readable status, timeline, evidence/report viewers,
  and approval actions.

Everything else in the PRD (Operations Control Centre, Field Agent App, Provider Portal, payments,
WhatsApp integration, etc.) is scoped but not yet built — see the PRD's phased roadmap (Section 11.4)
and feature priorities (Section 12) for what comes next.

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
