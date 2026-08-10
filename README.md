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
- **Quote Line Categories** (P0 Technical Build Spec Section 15/16 "Quote Engine / Quote Line
  Categories") — a quote is its categorized `QuoteLine[]` now, not one flat number: `ASOJU_SERVICE_FEE`,
  `EXTERNAL_COST`, `THIRD_PARTY_PROFESSIONAL`, `TAX_STATUTORY` (Section 4's "Do not hide external costs
  inside ASOJU fees"). This closes a real correctness gap the old flat-amount shape had: membership
  discount/SC now apply **only** to the `ASOJU_SERVICE_FEE` lines' sum (`Quote.baseAmount`) — everything
  else (`Quote.nonServiceFeeAmount`) passes through untouched, added back on top, at both quote-creation
  (`CommerceService.createQuote`) and acceptance (`MembershipService.commitBenefit`). A quote made up
  entirely of external/third-party costs is never discount-eligible and never counts against the
  monthly Concierge allowance. Ops issues quotes from a line-item builder (`/ops/cases/:id`); the
  customer and ops quote views both show the ASOJU fee, discount, SC, external costs, and third-party
  fees as separate lines, per the P0 UX Spec's "Customer Screen — Quote" table. Covered by
  `backend/test/quote-line-categories.e2e-spec.ts` (4 tests) — negative-control verified: computing the
  discount against the whole quote (service fee + external + professional) instead of the service fee
  alone fails the precise-math test; restoring it passes again.
- Payment status changes **only** via a real Paystack integration (`POST /api/invoices/:id/pay` starts
  hosted checkout; `POST /api/payments/webhook/paystack` verifies Paystack's actual HMAC-SHA512
  signature over the raw request body, not a shared-secret stand-in — Non-Negotiable #4, never a
  customer-facing screenshot) → `SCHEDULED`, and the case-status-history correctly attributes that
  transition to `system`, not a fake user. See "Payments" in Notes below for what "verified" means here.
- **Refunds** (P0 Technical Build Spec Section 20/21 "Payment Architecture / Payment States") — a
  `Refund` model existed in the schema with zero call sites; `POST /admin/payments/:paymentId/refund`
  (Finance/Admin/SuperAdmin only, UI on the Ops case page) is now the real thing: full or partial,
  always requires a reason (same discipline as the SC ledger's manual adjustment), calls
  `PaystackService.refundTransaction` (dry-run-friendly like every other Paystack call without
  `PAYSTACK_SECRET_KEY`), and moves the Payment to `PARTIALLY_REFUNDED` or `REFUNDED` depending on
  whether anything's still owed — never lets a refund exceed what's left. `PaymentStatus` now carries
  all eight of the spec's states; the webhook's amount-mismatch path also now sets
  `RECONCILIATION_REQUIRED` on the payment and case instead of just logging and doing nothing durable
  (`PROCESSING` is the one state this doesn't yet set anywhere — it'd need a provider-status poll, a
  separate increment). Covered by `backend/test/refund.e2e-spec.ts` (4 tests) — negative-control
  verified: disabling the over-refund guard lets a refund exceed the remaining balance and fails the
  test; restoring it passes again.
- **Payment expiry sweep** — a checkout started via `POST /invoices/:id/pay` that's abandoned (no
  webhook ever arrives) used to stay `PENDING` forever. `PaymentExpirySchedulerService` runs hourly
  (plus `POST /admin/payments/run-expiry-sweep`, Admin/SuperAdmin, for ops/testing — same
  on-demand-trigger pattern as the subscription billing and recurring-service sweeps) and marks any
  `PENDING` payment older than `PAYMENT_EXPIRY_HOURS` (default 24h) as `EXPIRED`, notifying the
  customer. Deliberately touches only the `Payment` row, never the case's own `paymentStatus` — the
  customer can always start a fresh payment on the same invoice, so one expired attempt is never the
  case's final word. Covered by `backend/test/payment-expiry.e2e-spec.ts` (3 tests) —
  negative-control verified: breaking the cutoff comparison leaves stale payments untouched and fails
  the test; restoring it passes again.

**Payment → Assignment → Field Execution**
- Staff assign a verified field agent/provider to a `SCHEDULED` case (→ `ASSIGNED`); the assignee
  accepts (→ `IN_PROGRESS`) or declines (case reopens to `SCHEDULED` for reassignment).
- **Job card** (P0 Technical Build Spec Section 22 "Job Card Engine") — the Field Agent App now shows a
  job card built from exactly the case's latest *confirmed* `CaseScope` (objective, scoped tasks,
  required evidence, exclusions), sourced from the same `GET /cases/:id` response every role already
  uses (`cases.service.ts` now includes the full `scopes` history). An unconfirmed revision (e.g.
  proposed mid-fieldwork) never displays as binding — the frontend only ever picks the latest entry with
  a `confirmedAt`, so "material scope changes cannot silently expand execution" (Section 14) holds for
  field execution too, not just quoting. Covered by `backend/test/job-card.e2e-spec.ts` —
  negative-control verified: removing the `scopes` include fails the test; restoring it passes again.
- The agent/provider submits `Evidence` (photo/video/doc/note, referencing a private object-storage
  key, never a predictable public URL) and marks fieldwork complete (→ `EVIDENCE_SUBMITTED`).

**Evidence → QC → Report → Completion**
- QC reviews and picks one of six outcomes (P0 Technical Build Spec Section 26 "QC Engine"): approve
  (creates the customer-facing `Report`, → `CUSTOMER_REVIEW`), approve with a recorded limitation
  (`PASS_WITH_LIMITATION` — same delivery path, but `note` is required and stored on the report as
  `limitation`, shown to the customer alongside the summary rather than silently folded into a clean
  pass), send back for rework (→ `IN_PROGRESS`), require a site revisit (`REVISIT_REQUIRED` — `note` is
  required and becomes a new, required `CaseTask` on the case, so it's a real checklist item the field
  agent sees, not just a status-history line, → `IN_PROGRESS`), or escalate/flag an incident without
  silently advancing the case (Section 8.5 — "a field submission is never automatically a completed
  case"). Covered by `backend/test/qc-outcomes.e2e-spec.ts` — negative-control verified: disabling the
  PASS_WITH_LIMITATION note requirement or the REVISIT_REQUIRED task's `isRequired` flag each fail their
  respective test; restoring both passes both again.
- The customer approves from the case detail page (→ `APPROVED` → auto-`COMPLETED`); closing
  (`COMPLETED` → `CLOSED`) stays a deliberate staff/finance action.

**Customer portal P0 screens** (Section 5.1): registration/login, the natural-language AI Concierge
request entry point, case dashboard, and case detail with human-readable status, timeline, quote/accept,
evidence/report viewers, and approval actions.

**Operations Control Centre** (Section 5.3), at `/ops`, staff-only:
- **Case queue** — org-wide, filterable by triage/payment/assignment/QC/escalations/completed. Every
  internal role can *see* the whole queue (that's the point of a queue); acting on or fully viewing a
  specific case still requires being an explicit `CaseCollaborator` (Non-Negotiable #6) — a one-click
  **Claim** button bridges the two so triage doesn't bottleneck on an admin.
- **Case management** — issue quotes, assign agents/providers, run QC (approve/rework/escalate),
  advance status manually, attach collaborators (admin), all from one page.
- **Agents & Providers directories** — admin-onboarding forms, provider verification-lifecycle
  controls (`PENDING → UNDER_REVIEW → VERIFIED → ACTIVE`, matching the Gate 2 source doc), agent
  activate/deactivate.
- Login redirects staff straight to `/ops`; customers to `/dashboard`.

**Field Agent App** (Section 5.4), at `/field`, for field agents and providers:
- **Job list** ("today's assignments") — every case they're assigned to, with their own
  accept/decline/check-in status shown inline.
- **Job card** — instructions, location, and the case's standard checklist (Section 6.1 — a
  per-service-type template of required steps, auto-seeded onto every case the moment it's created:
  Property Inspection, Construction Supervision, and Asset Inspection each get their own).
- **Workflow**: Accept → Check-in (server-timestamped, with GPS if the browser grants it) → tick off
  checklist items → capture evidence → **Submit fieldwork** (→ `EVIDENCE_SUBMITTED`) → **Escalate an
  exception** at any point, which flags the case (`CaseRiskFlag`) for staff without blocking or
  silently advancing it (Non-Negotiable #7 — never hide an unresolved issue).
- Login redirects agents/providers straight to `/field`.
- **Offline support** — checklist ticks and evidence captured without a connection queue to
  `localStorage` and sync automatically on reconnect (`lib/offlineQueue.ts`), with a banner showing
  what's queued. Deliberately scoped to those two actions: check-in wants a live GPS/timestamp fix, and
  accept/decline/submit are only meaningful against the assignment's current online state.

Every actor in the golden path has a working UI — that closes out the MVP. **All of Section 12 P1 is
now built and verified end-to-end**:

- **Saved beneficiaries/properties/assets** (Section 5.1 P1) — customers manage these from `/profile`
  ("My Nigeria"); staff triaging a request into a case (`/ops/requests/:id`) can link a customer's
  saved beneficiary/property/asset straight into the new case, with ownership re-verified server-side.
- **In-app notifications** — fires on quote issued, payment verified, assignment made,
  QC-approved-report-ready, RM assigned, and recurring-visit spawned; a bell in the header polls and
  shows an unread count. One channel only (in-app) — see notification *preferences* below for the
  channel this would fan out to once email/SMS/WhatsApp sending exists.
- **Ratings → provider/agent performance scoring** — a customer rates a `COMPLETED`/`CLOSED` case
  once; the score rolls up into a running average shown in the Ops agent/provider directories.
- **Referral system** — every customer gets a unique code on registration (copyable invite link on
  `/profile`); `/register?ref=CODE` pre-fills it. Records who-referred-whom only, no reward ledger.
- **Multi-provider coordination** — a case can carry more than one active assignment at once (e.g. a
  field agent for the physical visit *and* a lawyer for a title opinion); the Ops case page's
  assignment form stays open for additional assignments instead of locking after the first.
- **Document vault** — a `Document` (title docs, ID copies, receipts — distinct from inspection
  `Evidence`) can be attached to a case by the customer, staff, or an assigned agent/provider, visible
  in both the customer case view and the Ops case page.
- **Advanced provider portal** — providers manage their own credentials from `/field/credentials`
  (licenses, certifications, references); admin verifies them from `/ops/providers` — a provider can
  never verify their own credential.
- **Concierge workflow** — customers subscribe/cancel ASOJU Concierge from `/profile`; admin assigns a
  Relationship Manager to a customer's whole portfolio from `/ops/concierge` (not per-case); the RM
  sees their book from `/ops/portfolio`; a Concierge subscriber's new cases default to that tier.
- **Membership plans + SC ledger** (ASOJU P0 Technical Build Spec v1.0 Section 17/18, independent
  readiness review follow-up) — subscribing to Concierge now means choosing Priority ($99/mo, $50 SC,
  10% discount, 2 eligible requests/mo) or Premium ($299/mo, $150 SC, 15%, 5/mo). SC is a real
  append-only ledger (`ScLedgerEntry`/`ScLedgerService`, GRANT/DEBIT/REVERSAL/ADJUSTMENT/EXPIRY) —
  balance is always computed from the ledger, never a stored column a request can overwrite.
  `MembershipService` applies the discount/SC as a read-only *preview* when staff quote a CONCIERGE-tier
  case (`POST /cases/:id/quotes`), and only actually debits the ledger when the customer accepts —
  re-validated against the live balance at that moment, not the stale preview, and capped so the ledger
  can never go negative. A manual Finance/Admin adjustment (`POST
  /admin/subscriptions/:id/sc-adjustment`, UI at `/ops/concierge/:subscriptionId`) always requires a
  reason and is itself just another ledger row. Membership pricing is USD; the NGN amount actually
  charged/applied uses a manually configured `USD_TO_NGN_RATE` (not a live FX feed — see the env
  template), locked onto each subscription at subscribe time so a later rate change never retroactively
  alters an existing member's price. Covered by `backend/test/membership.e2e-spec.ts` (8 tests, real
  Postgres) — confirmed to actually enforce the numbers, not just plausible-looking code: verified live
  that a broken discount calculation fails 3 of the 8 tests, restoring it passes all 8 again.
- **Admin-configurable plan pricing** (P0 UX Spec "Admin Screen — Pricing Configuration") — the four
  numbers above (price, SC grant, discount%, eligible requests/mo) are no longer a code constant; they
  live in `MembershipPlanConfig` (one row per plan, seeded by migration with the original values) and
  are read live by `PlanConfigService.getConfig()` everywhere pricing used to be hardcoded. Finance/Admin
  edit them from `/ops/concierge` (`PATCH /admin/membership-plans/:plan`, audited with before/after
  values); anyone logged in can read current pricing (`GET /membership-plans`), which is what the
  `/profile` plan picker now fetches instead of showing baked-in numbers. The same locked-vs-live split
  from the SC ledger work carries over deliberately: a price edit only affects *new* subscribers — an
  already-active `Subscription` keeps the `priceUsd`/`fxRate`/`amount` it locked in at subscribe time —
  while a discount/SC/allowance edit applies live to every current member's very next quote or renewal.
  Covered by `backend/test/plan-config.e2e-spec.ts` (7 tests) — verified with the same negative-control
  discipline: disabling the Finance/Admin role check fails the 403 test, and hardcoding the discount back
  into `MembershipService.previewBenefit()` fails the live-read test; restoring both passes all 7 again.
- **Scope, versioned and confirmed before a quote can exist** (P0 Technical Build Spec Section 14 /
  Engineering Backlog EPIC F, same follow-up) — a `CaseScope` (objective, tasks, deliverables,
  exclusions, evidence requirements) is now a real prerequisite for `POST /cases/:id/quotes`, not just a
  free-text description: no scope, or the latest version unconfirmed by the customer, and quoting is
  rejected outright. Staff propose it from the Ops case page's new "Scope" card; the customer sees and
  confirms it from their case page before any price appears. Revising the scope after a quote already
  exists starts a new, unconfirmed version rather than mutating the old one in place — issuing another
  quote needs that new version confirmed too, so "material scope changes create a traceable new version
  and cannot silently expand execution" (the spec's own acceptance line) is enforced, not just written
  down. Every `Quote` now carries `scopeId`, recording exactly which confirmed version it was issued
  against. Covered by `backend/test/scope.e2e-spec.ts` (8 tests) — verified with the same negative-control
  discipline as the membership work: temporarily removing the confirmation check breaks 2 of the 8 tests
  (with a state-machine side effect, not just the obvious one — the case gets stuck QUOTED from the
  incorrectly-allowed first quote, which is itself a useful confirmation the gate matters), restoring it
  passes all 8 again.
- **Recurring services** (Section 6 — Construction Supervision is "the first recurring-revenue
  product") — staff turn a completed case into a recurring schedule from the Ops case page; a daily
  cron sweep (plus an admin-triggerable manual run for ops/testing) spawns the next case on schedule,
  copying the checklist and notifying the customer, without needing the original case to still exist.
- **Advanced analytics** — `/ops/analytics` (admin/finance) computes a working subset of Section 13's
  success metrics live from the same tables everything else writes to: completion rate, repeat-customer
  rate, revenue collected, average case value, average rating, QC rework rate, incidents by severity.
- **Notification preferences** — customers pick their preferred channel (WhatsApp/email/SMS) from
  `/profile`; this is the field a real channel fan-out would read from once it exists.
- **WhatsApp AI integration — outbound verified live, inbound still a stand-in.** Provider is Zavu
  (docs.zavu.dev). The inbound webhook, phone-only customer auto-creation, server-side
  conversation-history persistence (`WhatsAppThread`), and outbound send are all built and reuse the
  exact same `AiService.converse()` the web chat uses. Outbound (`WhatsappSenderService`) has been
  smoke-tested against Zavu's real sandbox API with a `zv_test_...` key — it authenticates and hits
  `POST /v1/messages` correctly (confirmed by a real, specific 403 from Zavu: sandbox mode requires the
  recipient number to be pre-verified in their dashboard before a test key will simulate a send to it).
  Inbound signature verification (`WhatsappWebhookGuard`) is still the shared-secret stand-in — Zavu's
  public docs confirm the header name (`X-Zavu-Signature`) but not the exact signing algorithm, and
  that isn't a thing to guess at for a security guard. See "WhatsApp integration" in Notes below.
- **Customer service history** — the one Section 12 P1 item ("customer service history") that had
  no dedicated view until now: `GET /customers/:customerId/history` gives any ops role a customer's
  whole relationship with ASOJU in one place (all cases, total paid, average rating), surfaced at
  `/ops/customers/:id` and linked from the queue, the Concierge directory, and account pages.

With every Section 12 P1 item genuinely built and the two remaining PRD gaps (real payments, offline
support) closed, the platform completed **Section 12 P2** — deliberately the minimal, real slice of it,
not the "full marketplace" versions Section 11.2 explicitly rules out ("full family-care marketplace",
"full procurement marketplace", "full investment marketplace", "complex subscription ecosystem"):

- **Expanded service catalogue** — the three MVP services are joined by five more `ServiceType`
  categories (Family Support, Procurement, Business Verification, Investment Support, Agriculture
  Support) straight from the PRD's "diaspora operations layer" language, each with its own Section 6.1
  standard checklist. Same case engine, same QC/evidence/report pipeline — no new marketplace, no new
  workflow to build or maintain.
- **Corporate/family accounts** — the `Account` model has existed in the schema since Section 3 and was
  never wired up; it now groups several customers under one household or company. Admin manages
  accounts and membership from `/ops/accounts`; a member sees a **read-only** roster of who else shares
  the account and what's being handled for each from `/profile` — deliberately a visibility layer, not
  a shared-access one: opening a case someone else in the account owns still requires being that case's
  customer or an assigned collaborator (Non-Negotiable #6 is untouched by this feature).
- **Advanced risk engine** — `RiskEngineService` computes a deterministic score (never an AI judgment
  call, the same philosophy as the Case Engine's state machine) from signals already in the database:
  open risk flags, incident severity on this case, prior incidents on the customer's other cases, a
  low-performing assignee, urgent priority, QC rework cycles, high case value. Runs automatically when
  an agent raises an exception or QC escalates/reworks a case, is available on demand from the Ops case
  page ("Recompute risk level"), and a high score auto-raises a `CaseRiskFlag` that surfaces in
  Compliance/Risk's own queue at `/ops/risk`.
- **Personal AI assistant** — distinct from the intake Concierge: `/ai/assistant/message` answers an
  *existing* customer's questions about their own cases, subscription, and saved beneficiaries/
  properties/assets, grounded only in a context block of that customer's real data — no tool-use, no
  mutation, nothing invented. Surfaced as "Ask ASOJU" on `/dashboard`. Fails closed without
  `ANTHROPIC_API_KEY`, exactly like the intake Concierge.
- **Bounded subscription billing engine** — Section 11.2 explicitly rules out a "complex subscription
  ecosystem", so this is the real, minimal slice: `SubscriptionBillingService` bills each Concierge
  subscription's flat recurring amount every 30 days through the same Paystack integration as case
  payments, generates a `SubscriptionInvoice` per period, and lapses the subscription if the previous
  period's invoice never got paid rather than letting debt pile up. A daily cron runs the sweep;
  `POST /api/admin/subscriptions/run-billing` triggers it on demand. Billing history shows on `/profile`.
- **Partner portal** — an external referral organisation (a diaspora association, a Nigerian business,
  an individual agent — Section 1's "distribution/partnership channels"), attributed at registration via
  `/register?partner=CODE` alongside the existing peer-to-peer referral code. Admin manages partners
  from `/ops/partners`; a `PARTNER`-role login (provisioned the same non-self-service way as every other
  staff/field role) gets a read-only dashboard at `/partner` of who they've referred and what's
  happening for each — no financials, the same discipline as the corporate/family Account member view.

What's left from the PRD is everything the spec itself defers past P2: Section 12 P3
(white-label, public APIs, multi-country support, marketplace, SaaS billing, partner ecosystem,
predictive analytics) and the infrastructure Section 11.2 explicitly says not to build in-house
(escrow, proprietary wallet, native mobile apps). See the PRD's phased roadmap (Section 11.4) for the
scale-up gates beyond that.

## Production hardening

An independent build-readiness review (against an earlier snapshot of this repo) flagged a set of P0
launch-critical gaps. The ones addressable in code — as opposed to needing a live external account,
hosting infrastructure, or a written operating procedure — are closed and covered by automated tests:

- **Payment webhook failure handling** — `charge.failed` (and any other Paystack event) used to be
  silently ignored; it's now recorded and the customer told, without changing case status so they can
  retry from their case page.
- **Offline-queue idempotency** — a replayed checklist completion is a no-op rather than
  re-timestamping it; evidence submission accepts a client-generated `clientRequestId` so a dropped
  response and its retry can never create two Evidence rows.
- **Document classification** — a `Document` can now be marked staff-only or restricted to one specific
  assignment, and a field actor's view (both the dedicated endpoint and the embedded array on
  `GET /cases/:id`) is filtered accordingly; customer and staff are always unrestricted.
- **Curated case file for operational staff** — seeing a case in the org-wide queue is metadata-only
  visibility (Section 7.1); Case Manager, QC, Finance, and Compliance-Risk now also get the customer's
  name and contact details withheld everywhere staff can reach them (queue, case detail, the customer
  service-history lookup) — the case number, not the customer's identity, is what they work with. RM
  and Admin/Super Admin are unaffected (`backend/src/common/pii-restricted-roles.ts`).
- **Authorization test suite** (`backend/test/authorization.e2e-spec.ts`) — 29 tests, real app, real
  Postgres: cross-customer IDOR, field-actor BOLA, the org-wide-queue-vs-case-content-access
  distinction, document classification, curated-case-file PII redaction, partner-role isolation,
  role-mismatched privilege escalation. Confirmed to actually catch a regression (temporarily removing
  `CaseAccessGuard` fails 4 of them; temporarily disabling the PII redaction fails its own test).
- **Privileged authentication** — self-rolled TOTP MFA (enroll → confirm → login challenge, via
  `backend/src/auth/totp.ts`, same "self-rolled, swap for a managed provider later" philosophy as the
  JWT auth itself), password reset (never reveals whether an email exists, revokes every existing
  session, single-use token), `logout-all` session revocation, and a tighter brute-force throttle on
  the auth endpoints specifically. Covered by `backend/test/privileged-auth.e2e-spec.ts`.
- **AI safety tests** (`backend/src/ai/ai.service.spec.ts`, unit not e2e) — `@anthropic-ai/sdk` is
  mocked to return attacker-shaped tool output (extra fields, an out-of-range engagement score, a
  refused tool call), proving the code enforces its trust boundaries regardless of what the model
  returns: the model can never set `customerId`, an out-of-range score gets clamped instead of trusted,
  a refused structured response throws instead of falling back to freeform parsing, and every completed
  intake is audited as AI-attributed, never as the user acting directly.

See `backend/test/README.md` for how to run all of the above.

A later infrastructure pass closed the one item on that list that was actually a code gap, not just a
missing vendor account:

- **Object storage** (`backend/src/storage`) — `Evidence.storageKey`/`Document.storageKey` used to be
  plain client-supplied strings with nothing behind them. Now the backend is the sole issuer: a
  presigned-upload endpoint (`POST /cases/:id/evidence/upload-url` and `.../documents/upload-url`)
  mints a case-scoped key and a short-lived signed PUT URL against an S3-compatible bucket (AWS S3, R2,
  Spaces, or MinIO for local dev — Section 11.2's "buy, don't build"); the create endpoints reject any
  storageKey that wasn't issued for that case, and verify the object actually exists once real storage
  is configured. Documents/evidence are served back with a short-lived signed view URL, never the raw
  key. With `S3_BUCKET` unset it runs in dry-run mode — same "works without credentials" shape as
  Paystack/WhatsApp/Anthropic — so this needed no new external account to build or test.

What that review flagged as needing a live external account, hosting/infra decisions, or a written SOP
— live WhatsApp verification, secrets management, backup/restore testing, a penetration test, and the
operational runbooks themselves — is unchanged: still open, and out of this repo's reach either way.

Staging/production separation was next, and — like object storage — turned out to have a real code
component underneath the infra decision:

- **Three distinct env templates, not one.** `.env.example` (development) is joined by
  `.env.staging.example` and `.env.production.example` at the repo root. All three set every var this
  app reads; what differs is which values go in, and each file says explicitly what must never be
  shared with another environment (database, secrets, external accounts, domain).
- **Fail-fast startup validation** (`backend/src/config/validate-production-env.ts`) — refuses to boot
  with `NODE_ENV=production` if `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`/`WHATSAPP_WEBHOOK_SECRET` are
  missing, too short, or still equal to the checked-in dev defaults; if `DATABASE_URL` is unset; or if
  `CORS_ORIGIN` is unset (which otherwise silently falls back to allowing every origin). Collects every
  problem into one error instead of failing on the first. Covered by 9 unit tests, and manually smoke-
  tested both ways: it refuses to boot on an unedited `.env.example` under `NODE_ENV=production`, and
  boots cleanly once every value is actually filled in.
- **`GET /health` and `GET /health/ready`** — every managed host needs something to poll; there was
  nothing here to poll before. Liveness (`/health`) just confirms the process is up; readiness
  (`/health/ready`) actually queries the database, so a host can stop routing traffic to an instance
  that's up but can't reach Postgres. Unauthenticated and exempt from the brute-force throttle, since a
  host's probe carries no session.
- **CI** (`.github/workflows/ci.yml`) — runs the full backend suite (unit + e2e, against a real
  Postgres service container) and the frontend build on every push/PR. There was no CI at all before
  this; a broken build could previously only be caught by running the suites locally. A `deploy` job
  now follows the two test jobs — see "Deploying (Railway)" below for what it does and, more
  importantly, the manual setup it depends on that no amount of code can do for you.

## Deploying (Railway)

Railway was the host chosen for this project (project ID `3a589d6b-ad92-4c4d-bc3d-ffe570480345`).
Everything below the line is code already in this repo; everything above it is a one-time manual setup
in Railway's dashboard that I have no access to do for you — I can't create services, add a database
plugin, or generate a token on your behalf. **None of this has been deploy-tested against your actual
project** — it's built from Railway's documented conventions (Nixpacks build detection, `railway.json`
per-service config, project-scoped CLI tokens), not verified against a real deploy. The first push to
`main` after you finish the setup below is the real test; if the exact CLI flags have drifted from what
a current `@railway/cli` expects, that run's log will show you exactly what to adjust.

**One-time setup, in Railway's dashboard, inside that project:**

1. **Two services**, both connected to this GitHub repo:
   - `backend` — Root Directory: `backend`. Railway will pick up `backend/railway.json` (build command
     via Nixpacks auto-detection, start command `npm run prisma:deploy && npm run start:prod` — the
     migration runs on every boot; `prisma migrate deploy` takes its own advisory lock, so this stays
     safe even if this service ever scales to more than one instance).
   - `frontend` — Root Directory: `frontend`. Picks up `frontend/railway.json`.
   - For both: turn **off** "Deploy on Push" in the service's Settings → this workflow's `deploy` job
     is what should trigger deploys, gated on tests passing, not Railway's own push listener.
2. **A Postgres plugin**, added to the project — Railway generates its own `DATABASE_URL` reference
   variable; point the `backend` service's `DATABASE_URL` at that reference rather than typing it in by
   hand.
3. **Environment variables on each service**, following `.env.production.example` — every value that
   file lists as needing to be real (JWT secrets via `openssl rand -hex 32`, `CORS_ORIGIN` set to the
   frontend's Railway domain, `NEXT_PUBLIC_API_URL` on the frontend service set to the backend's Railway
   domain, live Paystack/WhatsApp/S3 credentials once you have them — dry-run mode is fine for everything
   you haven't set up yet, same as local dev). `backend/src/config/validate-production-env.ts` will
   refuse to boot the backend service if the JWT/WhatsApp secrets or `CORS_ORIGIN`/`DATABASE_URL` are
   missing or still placeholder values — that's intentional, and it's the fastest way to find out
   something here was missed.
4. **A Railway project token** (Settings → Tokens, scoped to this project) — add it to this GitHub
   repo's secrets as `RAILWAY_TOKEN` (Settings → Secrets and variables → Actions → Secrets).
5. **The two service names**, exactly as typed into Railway when the services were created — add them
   to this GitHub repo's Actions **variables** (same page, "Variables" tab, not "Secrets" — they aren't
   sensitive) as `RAILWAY_BACKEND_SERVICE` and `RAILWAY_FRONTEND_SERVICE`.

Once all five are in place, a merge to `main` runs the test suites and, only if they pass, deploys both
services via `railway up`.

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

- Staff/agent/provider/partner accounts are not self-service — `POST /api/auth/register` only creates
  `CUSTOMER` accounts (Section 5.1 progressive-disclosure onboarding). Provision staff, a `PARTNER`-role
  login, or a `PartnerContact` link directly via Prisma/psql until the Admin Console (Section 5.7)
  exists.
- The AI Concierge endpoint (`POST /api/ai/concierge/message`) and the personal assistant
  (`POST /api/ai/assistant/message`) both require `ANTHROPIC_API_KEY` to be set; without it, they fail
  closed rather than silently degrading.
- **Payments (Paystack)**: set `PAYSTACK_SECRET_KEY` to enable real hosted-checkout initialization
  (`POST /api/invoices/:id/pay`, `POST /api/admin/subscriptions/run-billing`) and real webhook signature
  verification (`POST /api/payments/webhook/paystack`, see `PaystackWebhookGuard`) — the guard verifies
  Paystack's actual HMAC-SHA512 scheme over the raw request body (`app.rawBody`), not a shared secret.
  Leave it unset to run checkout initialization in dry-run mode (logs, returns a placeholder URL, charges
  nothing — see `PaystackService`); the webhook fails closed (rejects everything) without a key
  configured, the same pattern as the AI Concierge. This has been verified two ways: dry-run
  initialization end-to-end, and the webhook's signature verification against a hand-crafted,
  correctly-signed payload (wrong signature → 401, amount mismatch → 400, correct signature → payment
  marked PAID and case transitions) — neither this repo nor its test scripts have a real Paystack
  account, so the outbound "call Paystack's live API" leg specifically is unverified, same caveat as
  WhatsApp below.
- **MFA / password reset / session revocation**: `POST /api/auth/mfa/enroll` (authenticated) starts TOTP
  enrollment; `.../mfa/confirm` activates it; once active, `POST /api/auth/login` returns
  `{ mfaRequired: true, mfaToken }` instead of tokens, and `POST /api/auth/mfa/verify` exchanges the
  code for a real session. `.../mfa/disable` requires the current password. `POST /api/auth/forgot-password`
  never reveals whether an email exists, and now sends a real reset-link email via Resend (`EmailService`,
  `RESEND_API_KEY`) — smoke-tested against Resend's live API (a real successful send to their
  `delivered@resend.dev` test address, and a real 422 confirming their test-mode recipient restriction
  applies until a sending domain is verified). Outside production it also still returns `devToken`
  directly for local dev without needing a Resend key configured. `POST /api/auth/reset-password`
  consumes it once and revokes every existing refresh token. `POST /api/auth/logout-all` (authenticated)
  revokes every session on demand. See `/profile` → Security
  for the customer-facing UI; there's no equivalent staff settings page yet, so a staff member currently
  needs to call these endpoints directly to enroll in MFA.
- A staff member needs to be an explicit `CaseCollaborator` on a case to act on it or view full detail
  (not just hold the right role) — triaging a request auto-attaches the triaging staff member;
  `POST /api/cases/:caseId/claim` self-attaches (used by the Ops Console); `.../collaborators`
  (admin-only) attaches anyone else.
- The very first staff/admin account has no self-service path — seed it directly via Prisma/psql
  (`npm run seed --workspace=backend` once you've written a seed script, or a one-off script like the
  ones used during development). Every subsequent agent/provider account can then be onboarded through
  `/ops/agents` and `/ops/providers`.
- A case's checklist is fixed at creation time from `backend/src/cases/checklist-templates.ts` — there's
  no UI yet to customize a checklist per case, only per service type.
- A mistyped/expired referral code at registration is silently ignored rather than blocking signup —
  check `GET /api/me/referral` if you need to confirm a code is actually valid before sharing it.
- A `RecurringSchedule` is unique per origin case — cancelling (`PATCH /api/cases/:caseId/recurrence`,
  `{"active":false}`) pauses it rather than deleting it, so reactivating resumes the same schedule
  (with the clock reset from the reactivation moment, not wherever it was paused).
- **WhatsApp integration** (Zavu, docs.zavu.dev): set `WHATSAPP_WEBHOOK_SECRET` to accept inbound
  messages at `POST /api/webhooks/whatsapp` (shared-secret stand-in — Zavu's real inbound signature
  scheme isn't confirmed publicly enough to implement; see `WhatsappWebhookGuard`'s comment). Set
  `ZAVU_API_KEY` (and optionally `ZAVU_SENDER_ID`) to send for real — leave unset to run in dry-run
  mode (logged, not delivered — see `WhatsappSenderService`). A `zv_test_...` sandbox key authenticates
  and hits the real API but never delivers a message (Zavu's own docs: test keys simulate only), and
  Zavu's sandbox additionally requires the recipient number to be pre-verified in their dashboard before
  it'll even simulate a send — confirmed by a real 403 from their API during testing, not assumed. A
  first message from an unrecognized number auto-creates a phone-only customer account, same "front
  door" pattern as Section 7.2. Outbound is live-verified; inbound is not — see the P0 line above.
- The daily recurring-schedule sweep runs via `@nestjs/schedule`'s cron (`RecurringSchedulerService`);
  `POST /api/admin/recurring/run` (admin-only) triggers it on demand, which is also how to test a new
  schedule without waiting for its cadence to elapse.
