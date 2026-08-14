# ASOJU FieldForce

FieldForce is ASOJU's **internal product for trusted field agents** operating
in the Nigeria market — gig-style mission assignment, GPS check-ins, evidence
capture, wallet/earnings, and an admin ops console for dispatch and QC. It is
a separate, standalone product from the main ASOJU platform (`../backend` +
`../frontend`), which serves the diaspora customer market. ASOJU launches
first; FieldForce is planned to open more broadly to the Nigeria market later.

## Why this lives next to `backend/` and `frontend/` but isn't part of them

FieldForce has its own domain model (agents, missions, gigs, wallet — not
ASOJU's cases/accounts/payments model), its own Next.js app, its own Prisma
schema and database, and its own chat microservice. It is **not** merged into
`backend/`'s NestJS modules or `frontend/`'s pages.

The two products talk to each other over an explicit, authenticated contract
instead of sharing a database:

- **`src/lib/integration-gateway.ts`** — HMAC-signed (`client id + timestamp +
  nonce + signature`, 5-minute replay window, scoped, rate-limited) API
  contract that lets ASOJU call into FieldForce (e.g. `missions:read`,
  `cases:read`) without ASOJU re-implementing FieldForce's mission state
  machine.
- **`src/lib/asoju-api.ts`** — the client FieldForce's own frontend uses to
  call its own `src/app/api/*` routes (agent auth, gigs, missions, wallet,
  earnings, support).

Anywhere FieldForce's needs genuinely overlap with infrastructure ASOJU's
backend already has (Paystack payouts, WhatsApp notifications, evidence
custody chain-of-custody), FieldForce currently has its own implementation
under `src/lib/` (`paystack.ts`, `whatsapp-gateway.ts`, `evidence-custody.ts`)
rather than calling the backend service — worth revisiting once the
Integration Gateway is live end-to-end, so payouts/notifications aren't
implemented twice.

## Structure

- `src/app/` — Next.js App Router pages + `api/*` route handlers (admin,
  customer, agent, gigs, missions, wallet, earnings, chat, health, webhooks)
- `src/components/` — admin console, customer/beneficiary chat views,
  onboarding flow, gig board, mission workspace, messaging UI, shared
  shadcn/ui primitives
- `src/lib/` — domain logic: mission/QC state machines, care-plan engine,
  trust score, GPS geofencing, SOS protocol, live tracking, evidence custody,
  outbox/sync protocol, integration gateway
- `prisma/schema.prisma` — FieldForce's own schema (separate DB from ASOJU's)
- `chat-service/` — standalone Bun + Socket.io chat microservice (its own
  SQLite DB under `chat-service/data/`, file uploads under
  `chat-service/uploads/`)
- `docs/build-notes/` — design/build notes carried over from the sessions
  that built the chat service, admin API routes, and messaging UI

## Running locally

FieldForce is Bun-managed and run independently of the `backend`/`frontend`
npm workspaces:

```bash
cd fieldforce
cp .env.example .env        # fill in secrets
bun install
bun run db:push             # create the local SQLite schema
bun run dev                 # Next.js app on :3010

# in a second terminal
cd fieldforce/chat-service
bun install
bun run dev                 # chat service (see index.ts for its port)
```

## Status

This app was recovered from a workspace snapshot that had been committed to
the repo by accident (see `../CHANGELOG` / git history around the
"FieldForce" commit) and re-added here as proper source. It has not yet been
re-verified end-to-end in this repo (dependency install, build, and the
Integration Gateway round-trip with `../backend` are all unverified) — treat
it as a recovered checkpoint, not a tested release.
