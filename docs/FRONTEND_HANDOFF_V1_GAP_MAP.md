# Frontend Handoff v1.0 — Sprint 0 Repository Audit & Gap Map

Produced against `docs/frontend-handoff-v1.0/` (the 60-file "ASOJU Frontend
Developer Handoff v1.0", 15 Aug 2026) and `docs/v2.0-engineering-specs/`
(the 7-file "Complete Updated Engineering Documentation v2.0", same date).

This is the Sprint 0 deliverable those documents themselves call for:
*"Create a route/component/API/state mapping document in the repository...
Record unresolved backend questions rather than guessing."* Nothing in this
document changes application behavior — it is the map that later sprints
build from.

Scope note: the handoff ZIP's `99_Supplemental/` folder (45 files — pitch
deck, financial model, GTM plan, board/investor playbooks, brand
guidelines, SOPs, etc.) is business/operations material, not engineering
input, and was intentionally **not** copied into this repo or audited here.

---

## 1. Locked six-service architecture vs. the real backend

The handoff locks the public product to exactly six service families —
**ASOJU Arrivals, Inspect, Build, Care, Verify, Assist** (Farewell is
explicitly excluded) — and requires "the frontend to remain aligned with
the existing backend case engine [and] service configuration."

The real backend (`backend/prisma/schema.prisma`) has a 10-value
`ServiceType` enum built up over many prior sessions, with real, working
logic keyed off the granular values (regional pricing, predictive costing,
QC outcome taxonomy, quote line categories, `service-verticals.e2e-spec.ts`,
etc.):

| Family (locked, public) | Current `ServiceType` value(s) |
|---|---|
| ASOJU Arrivals | `ARRIVAL_SUPPORT` |
| ASOJU Inspect | `PROPERTY_INSPECTION`, `ASSET_INSPECTION` |
| ASOJU Build | `CONSTRUCTION_SUPERVISION` |
| ASOJU Care | `FAMILY_SUPPORT`, `BEREAVEMENT_SUPPORT` |
| ASOJU Verify | `BUSINESS_VERIFICATION` |
| ASOJU Assist | `PROCUREMENT`, `INVESTMENT_SUPPORT`, `AGRICULTURE_SUPPORT` |

The mapping is clean — every existing value has exactly one home. Per your
decision, this is a **real backend restructuring**, not just a frontend
label. Two ways to execute it, for a Sprint 1 ticket (not done in this
pass):

- **A — Rename & collapse.** `ServiceType` → `ServiceFamily` (6 values).
  The current 10 values move to a new, non-enum `serviceSubtype` string/tag
  column (or a small lookup table) so the granularity every other feature
  already depends on isn't lost. Every switch/branch on the old 10 values
  (controllers, `predictive-costing`, `regional-pricing`, `quote-line-categories`,
  seed data, and the e2e specs that assert on them) needs updating.
- **B — Additive family layer.** Keep `ServiceType` exactly as-is; add a
  required `ServiceFamily` enum + a `SERVICE_TYPE_TO_FAMILY` lookup map
  used only by public-facing surfaces (homepage, service pages, Concierge
  classification). Smaller diff, lower regression risk against the 46
  existing e2e specs; family becomes a derived/display concept rather than
  the system's real taxonomy.

Recommendation: **A**, since you asked for the enum itself restructured —
but flagging that A's blast radius includes every one of the ~10 backend
modules and e2e specs above, which should be scoped as its own ticket
rather than folded into frontend Sprint 1.

**Closed, Option B (17 Aug 2026):** `A`'s full restructuring never got its
own ticket; `B` — the additive layer — is now real, not just this table.
`backend/src/cases/service-family.ts`'s `SERVICE_TYPE_TO_FAMILY` maps
every real `ServiceType` value (12 now, not 10 — `LEGAL_DOCUMENT_SERVICES`/
`HEALTHCARE_COORDINATION` were added by the Platform Expansion PRD after
this table was first written, categorized here the same way: legal/
document work with the other verification-shaped service, healthcare
coordination with the other family-support ones) to exactly one of the six
locked families, computed fresh rather than hand-duplicated. `GET
/service-families` is genuinely public (no auth — same reasoning as the
anonymous Concierge demo endpoint), and every case response
(`GET /cases`, `GET /cases/:id`, including the beneficiary curated view)
now carries a derived `serviceFamily` alongside the untouched real
`serviceType` — additive, never replacing it. `ServiceType` itself, and
every module keyed off its 12 granular values, is exactly as it was.
Covered by `backend/test/service-family.e2e-spec.ts` (4 tests, including
an exhaustiveness check that every real `ServiceType` value lands in
exactly one family). `frontend/src/lib/services.ts`'s own
`SERVICE_FAMILIES.serviceTypes` — previously acknowledged in its own
comment as "display-only... not yet wired" — is kept hand-in-sync with
this backend mapping (including the two newer service types it was
missing), though it still isn't fetched from the new endpoint at render
time; wiring the homepage/service pages to the live endpoint instead of
the static list is a smaller, separate follow-up, not attempted here.

---

## 2. The one P0-blocking backend gap: Concierge requires auth today

This is the single most important finding. The whole handoff's core journey
is:

> Discover → **AI Concierge (anonymous)** → Clarify → Structured Request →
> **Authentication** → Formal Case → Scope → Quote → Payment → ...

i.e. Concierge conversation happens *before* login; authentication is only
required at formal case creation. The real backend does not support this:

- `POST /api/ai/concierge/message` (`backend/src/ai/ai.controller.ts`) sits
  behind `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(Role.CUSTOMER)` —
  **an anonymous visitor cannot call it at all today.**
- Confirmed on the frontend side too: `ConciergeChat.tsx` calls the real,
  authenticated endpoint (used post-login); the homepage's
  `ConciergeDemo.tsx` is explicitly a **scripted, fake demo** — its own
  comment says *"does not call the real /ai/concierge/message"*. Today,
  anonymous visitors never talk to the real AI at all.
- The good news: `AiService.converse()` is otherwise already shaped for
  this. It's stateless per call (`message` + client-supplied `history[]`,
  no `caseId`), so it doesn't structurally need a logged-in customer — it
  only needs the `@Roles(Role.CUSTOMER)` guard relaxed for an anonymous
  path, plus somewhere to persist the pre-auth conversation
  (`AiInteraction` currently assumes `user`) so it can be handed to
  `POST /service-requests` after sign-in without re-asking everything.

This is the backend contract gap that blocks the handoff's own P0 critical
path (item 2: *"Anonymous Concierge starts"*). It needs a product decision
(new unauthenticated endpoint? session-scoped anonymous token? rate-limit
strategy for an unauthenticated LLM endpoint?) before Sprint 2
("AI Concierge foundation") can be built for real, rather than as another
scripted demo.

---

## 3. Route/component/API inventory (repo reality vs. handoff intent)

### Existing frontend routes (`frontend/src/app/`)
`/` (homepage — 3-service marketing copy, not 6), `/login`, `/register`,
`/forgot-password`, `/reset-password`, `/dashboard`, `/cases`,
`/cases/[id]`, `/profile`, `/partner`, `/beneficiary`,
`/beneficiary/accept-invite`, `/beneficiary/cases`, `/field`,
`/field/cases`, `/field/credentials`, `/ops/*` (12 staff-console routes:
accounts, agents, analytics, audit, cases, concierge, customers,
notifications, partners, portfolio, providers, refund-approvals, requests,
risk).

None of the six locked public service-page routes (`/arrivals`, `/inspect`,
`/build`, `/care`, `/verify`, `/assist` or equivalent) exist yet — this is
genuinely net-new surface area, not a rename of something already there.

### Existing shared UI
No component-driven design system (no `Button.tsx`/`Card.tsx`/etc.). The
current pattern is global CSS classes in `globals.css` (`.btn`, `.card`,
`.badge`, `.case-list`, `.landing-*` for the marketing page, `.chat*` for
Concierge/chat UI) applied directly to plain HTML elements. The handoff's
Design System spec (`03_Design_System/`) wants a real
Foundation→Primitives→Composites→Product-components React library. This is
also genuinely net-new, not a refactor of existing components — building it
is Sprint 1 in the handoff's own plan.

Reusable pieces that do exist and should be kept, not duplicated:
`ConciergeChat.tsx` (real, authenticated), `SiteHeader.tsx`,
`NotificationBell.tsx`, `MilestoneProgress.tsx`, `VaultSection.tsx`,
`SecuritySettings.tsx`, `ArrivalProfileForm.tsx`, and the guard hooks
(`useAuthGuard`, `useFieldGuard`, `useOpsGuard`, `usePartnerGuard`,
`useBeneficiaryGuard`).

### Backend API surface relevant to the P0 critical path
| Journey step | Real endpoint | Notes |
|---|---|---|
| Concierge conversation | `POST /api/ai/concierge/message` | **Auth-gated — see §2.** |
| Concierge feedback | `POST /api/ai/concierge/feedback` | Auth-gated. |
| Register / Login | `POST /api/auth/register`, `POST /api/auth/login` | MFA-aware; matches handoff's auth-screen expectations. |
| Session | `GET /api/auth/me`, `POST /api/auth/refresh` | |
| Create structured request | `POST /api/service-requests` | Customer-only, matches "auth required before formal case." |
| List/convert requests | `GET /api/service-requests`, `POST /api/service-requests/:id/convert` | Convert is staff-only (triage → case), matches handoff's server-authoritative case creation. |
| Case detail/list | `GET /api/cases`, `GET /api/cases/:id` | |
| Scope | `GET/POST /api/scope`, `POST /api/scope/confirm` | Matches "scope confirmed before quote" gate exactly. |
| Quote | `POST /api/cases/:caseId/quotes`, `POST /api/quotes/:id/accept` | Server-authoritative totals — matches "no authoritative financial calc in the browser." |
| Payment | `POST /api/invoices/:invoiceId/pay`, `POST /api/payments/webhook/paystack` | Webhook-confirmed, matches "server/provider confirmation only." |
| Evidence | `POST /api/evidence/upload-url`, `POST /api/evidence` | Presigned-URL pattern, matches "signed/private access." |
| Notifications | `GET /api/notifications`, `POST /api/notifications/:id/read` | |

### Case/payment state enums (real, for the handoff's "actual states must be
mapped from backend enums" instruction)
- `CaseStatus`: `DRAFT, SUBMITTED, UNDER_REVIEW, QUOTED, AWAITING_PAYMENT,
  SCHEDULED, ASSIGNED, IN_PROGRESS, EVIDENCE_SUBMITTED, QUALITY_CONTROL,
  CUSTOMER_REVIEW, ADDITIONAL_WORK, APPROVED, COMPLETED, CLOSED, ON_HOLD,
  DISPUTED`
- `PaymentStatus`: `PENDING, PROCESSING, PAID, FAILED, EXPIRED, REFUNDED,
  PARTIALLY_REFUNDED, RECONCILIATION_REQUIRED`

These map cleanly onto the handoff's logical state categories (draft →
quoted → payment required → scheduled/assigned → in progress → QC/rework →
completed/cancelled) — no gap here beyond wiring the real names in.

---

## 4. Other flagged gaps (non-blocking, for later sprints)

- **Design system**: net-new component library, not a refactor (§3 above).
- **Six service-page routes**: net-new, not renames.
- **Homepage**: current copy/section order (3 services, no locked
  six-family cards, no "Discover → Concierge" as the dominant hero
  interaction) will need a real rebuild against the handoff's locked
  section order, not incremental edits.
- **Provider/booking availability for Arrivals** (transport/accommodation
  coordination) — no provider-availability backend surface exists yet
  beyond the general `ProviderStatus` enum and providers controller; the
  handoff requires this to be "backend/provider-authoritative," which is
  itself unbuilt for the specific Arrivals use cases (airport transport,
  accommodation booking).

---

## 5. Sprint Plan v2.1 revision (15 Aug 2026)

`docs/v2.0-engineering-specs/ASOJU_Developer_Implementation_Sprint_Plan_v2.1.docx`
supersedes the v2.0 sprint plan in that same folder. It makes two changes
worth recording here:

- **Confirms §4 above independently**: it explicitly calls out "the
  current repository has no frontend test framework configured" as a P0
  gap — the same finding this document flagged. **Closed**: Vitest +
  React Testing Library + jsdom is now set up
  (`frontend/vitest.config.ts`, `frontend/vitest.setup.ts`, `npm run
  test --workspace=frontend`, wired into `ci.yml`), with a 20-test
  baseline covering the Sprint 1 primitives (`Button`, `Field`/
  `Input`/`Textarea`, `Modal`, `Accordion`, `StatusBadge`) plus a
  homepage smoke test. Framework choice and rationale are documented in
  `vitest.config.ts`'s own comment, per that doc's "select ... document
  the selection and rationale" instruction. Still open: no protected-
  route/auth-state tests, no API-mocking-based loading/success/error
  tests, and no browser-level E2E framework yet (Playwright/Cypress) —
  those are the plan's own next items, not done here.
- **Introduces a materially larger, net-new architecture** not covered
  by anything audited so far: an `AutomationCapability`/`AutomationRule`/
  `AutomationDecision` eligibility engine (`AUTO` / `CUSTOMER_INPUT` /
  `ESCALATE` / `UNSUPPORTED` / `BLOCKED`), a deterministic `PriceBook`/
  `PriceRule`/`MultiplierRule`/`ExternalCostRule` pricing engine, and a
  standalone `Escalation` entity — none of which exist in the current
  backend. Fully scoped in `docs/AUTOMATION_PRICING_ENGINE_SCOPE.md`:
  what already exists to build on, why the pricing and automation pieces
  should ship as two separable tracks (pricing engine first, standalone
  and useful to staff on its own; automation eligibility second, built on
  top of a pricing engine that's already trustworthy), a five-phase
  breakdown, and five open decisions that need your direction before
  Phase 1 gets a real ticket.

## 6. Recommended next step (superseded by §7 — see below)

Sprint 1 (frontend design-system + global shell) and the P0 frontend test
infrastructure from §5 are both done — see git history on
`claude/new-file-repo-9fezh8`. **This section is stale as of 15 Aug 2026
— see §7.** Sprint 1's own component library and the Vitest/RTL test
infra it describes were removed during a large merge with `main` (a
parallel, independently-evolved frontend rewrite adopted wholesale by
explicit product decision — see the merge commit `cab1f95` and the
Escalation/Idempotency work around it for the full story). Backend
Phase 1 (Pricing Engine) and Phase 2 (Escalation + Idempotency) from §5's
scope doc are both done; the anonymous-Concierge decision from §2 was
resolved (chat-only, no structured data pre-auth) and implemented as
part of that same rewrite.

## 7. Re-audit against the inherited frontend (15 Aug 2026)

The `main` rewrite adopted in the merge above (Radix UI, Tailwind v4,
route groups under `(auth)`/`(customer)`/`(portal)`) turned out to cover
a large fraction of the original handoff's Sprint 2–8 backlog already,
under different component names than this branch originally built. Audited
against `docs/frontend-handoff-v1.0/05_Implementation/`'s actual sprint
checklists (not just skimmed) rather than assumed:

**Substantially done, verified against the real code:**
- **Sprint 2 (AI Concierge foundation)** — `AiConciergeDemo.tsx`: idle/
  typing/sending/response states, quick-prompt chips, thumbs up/down.
  Two gaps closed this session: the draft-persistence handoff to
  `dashboard/new` was half-wired (read side existed, write side didn't —
  see commit `36466d9`), and failed turns had no retry action (now a
  proper retry card). Still open: analytics events (needs a
  privacy-filtering scope decision — not invented here) and
  component/state-transition tests (no test framework exists post-merge
  — see §6's note; needs a tooling decision, not a unilateral pick).
- **Sprint 3 (Authentication & handoff)** — real sign-in (`(auth)/login`)
  with MFA/enrollment states, real registration (`(auth)/register`),
  session guard (`useAuthGuard`) redirecting unauthenticated visitors to
  `/login`, Concierge → auth → restored-request flow (closed this
  session). Minor gap: `useAuthGuard`'s redirect doesn't carry a
  `returnTo` back to the page the visitor was trying to reach, so a
  direct deep link to a protected page loses its destination after
  login (small, mechanical fix, not done here).
- **Sprint 4 (Homepage)** — `page.tsx` has hero (Concierge-dominant) →
  trust strip → six-service cards → How It Works → trust/proof →
  pricing → diaspora → final CTA → footer. Close to the locked order,
  though "Representation" and "Why ASOJU" aren't separately named
  sections the way the spec lists them — worth a content review, not a
  structural rebuild.
- **Sprint 7 (Customer workspace)** — `(customer)/layout.tsx` +
  `dashboard/*`: cases list, new-request wizard, billing, vault,
  notifications panel, profile — all real, all wired to real endpoints.
- **Sprint 8 (Cases)** — `dashboard/cases/[id]/page.tsx`: timeline,
  quote/payment surface (Paystack dry-run aware), evidence grid, reports,
  and the case-messaging thread (the feature folded in from `main` during
  the merge) — all present.

**Sprints 5 & 6 (Service-page framework + the six service pages) — ✅ done
same session (commit `4a5fd94`):** every one of `/arrivals`, `/inspect`,
`/build`, `/care`, `/verify`, `/assist` now renders through one shared
`ServicePageShell` (hero with a per-service Concierge embed, use-case
cards, the homepage's own How-It-Works/Trust sections reused verbatim,
per-service outcome + FAQ, closing CTA), configured entirely by
`lib/services.ts` — no page-specific markup, no fabricated pricing/
stats (Sprint 4's "Trust/proof ... using only approved data" governance
extended to these pages: `fromNgn` reuses the real prices already live
in `dashboard/new/page.tsx`, left undefined rather than guessed where
no real price exists yet). `ServiceComingSoon.tsx` removed as dead code.

**Also found and fixed this session, not a Sprint item but worth
recording:** `main`'s homepage carried a "From our customers"
testimonials section — three named people, cities and specific dollar
claims, presented as genuine reviews with no real customer data behind
them. Removed entirely (commit `7e8ee14`) rather than relabelled, per
the same governance principle above.

**Closed since the above was written:**
- `useAuthGuard`'s `/login` redirect now carries `?returnTo=`, read and
  validated by `/login`'s own `afterSignIn` — a direct deep link to a
  protected page survives the sign-in round trip.
- **Frontend test framework restored.** The pre-merge Vitest + RTL setup
  (§5's "Closed" note) didn't survive adopting `main`'s frontend rewrite
  — confirmed post-merge (`frontend/package.json` had no test
  dependencies, no config). Rebuilt against the current Radix/route-group
  component tree: `vitest.config.mts` (rationale in its own header
  comment), `vitest.setup.ts` (jsdom polyfills Radix and framer-motion's
  viewport feature need — `matchMedia`, `ResizeObserver`,
  `IntersectionObserver`, pointer-capture, `scrollIntoView`), 17 tests
  (`Button`, `Input`/`Textarea`, `Badge`, `Dialog` — the closest
  equivalents to the old baseline's primitives in this component set,
  which has no `Accordion`; plus a homepage smoke test, including a
  regression guard against the fabricated-testimonials section reappearing),
  wired into `ci.yml`'s `frontend` job ahead of the build step.

**Closed:** Sprint 2's analytics events. Scoping this turned up a bigger
question than "what's safe to log" — no analytics vendor (PostHog,
Segment, GA, …) was wired into the frontend at all, and picking one
carries its own privacy posture for a product handling diaspora users'
family/financial circumstances. Decision: first-party only, no vendor.
`ConciergeAnalyticsEvent` (backend, its own schema comment has the full
rationale) + `AiPublicController.recordAnalyticsEvent` — an enum event
name and a `metadata` shape validated at the boundary (flat, ≤5 keys,
each value a short string/number/boolean), not a JSON passthrough, so a
client bug can't smuggle a raw message into the table even by accident.
Wired into `AiConciergeDemo.tsx`: `CONCIERGE_OPENED` (mount),
`QUICK_PROMPT_CLICKED` (chip index only, not the prompt text),
`MESSAGE_SENT`/`MESSAGE_FAILED` (turn number only), `RETRY_CLICKED`.
Anonymous by design — a random per-tab id (`sessionStorage`), not a
userId, since most Concierge usage happens before sign-in.

**Still open, smaller items:**
- No protected-route/auth-state tests, no API-mocking-based loading/
  success/error tests, and no browser-level E2E framework (Playwright/
  Cypress) yet — the restored baseline covers presentational components
  only, same scope the original pre-merge baseline had.

## 8. Sprint 4 content review — homepage section list vs. the locked order

`05_Implementation`'s locked order (10 items): Hero (Concierge-dominant) →
Trust strip → Six-service cards → **Representation section** → How It
Works → **Why ASOJU** → Trust/proof (approved data only) → **Diaspora
section** → Final Concierge CTA → Footer.

`page.tsx`'s actual section list, read straight from the file rather than
assumed: NAV → Hero (`#services`-linked, Concierge embedded — matches)
→ Trust strip (matches) → Services (`#services`, matches) → How It Works
(`#how`, matches) → Trust (`#trust` — "We never say just 'verified'",
QC/evidence claims only, no invented stats; this is the locked
"Trust/proof" item content-wise) → **Pricing** (`#pricing` — not in the
locked list at all) → Final CTA (matches) → Footer (matches).

Net, checked against the file rather than the earlier "isn't 1:1"
shorthand: **three locked items have no distinct section in the current
build** — Representation, Why ASOJU, and Diaspora aren't separate
sections; nothing under those names or that content exists anywhere on
the page (the earlier revision of this doc listed "→ pricing → diaspora
→" from memory, not from re-reading the file — there is no diaspora
section, `#pricing` sits directly before the final CTA). Pricing, in
exchange, is real, substantial, unaccounted-for-in-the-spec content
(three-tier subscription cards with real configured prices).

**Closed (15 Aug 2026, later same day).** You supplied
`ASOJU_Frontend_Developer_Handoff_v1.0_with_readme.zip` — its `00`–`07`
folders are byte-identical to what's already in this repo, but it added
a `99_Supplemental/` (now copied into this directory) containing real,
already-approved copy for exactly the gap above:
`ASOJU_Homepage_Build_Blueprint_v1.0.docx` and
`ASOJU_Homepage_UI_UX_Frontend_Engineering_Spec_v1.0.docx` (near-
identical to each other, one derived from the other) lock the exact
headline/body text for Representation, Why ASOJU and Diaspora, plus the
six real service-card promises and a locked 4-step "How it works" copy.
`ASOJU_Messaging_Verbal_Identity_Guide_v1.0.docx` separately locks the
brand's actual primary tagline. Implemented directly from these — no
copy invented:
- Added the three missing sections with their locked headline/body text
  (Representation's visual sequence, Why ASOJU's 4-pillar table, and
  Diaspora's supporting copy + CTA), in the locked order.
- **Two more real bugs found auditing against these docs, both fixed:**
  (a) the "trust bar" below the hero was showing **fabricated stats**
  ("3,200+ tasks executed", "4.9/5 average rating", "48h median time",
  "100% evidence-backed") — exactly what the Build Blueprint's own §4.9
  says not to do ("Do not invent metrics or testimonials"); replaced
  with the 5 real positioning principles the spec locks for that strip.
  (b) the Services section was still showing **3 stale, generically-
  named services** ("Property Inspection & Verification" etc.) with no
  link to the six real, live service pages Sprint 5/6 already shipped —
  the homepage had simply never been updated after that work landed.
  Replaced with the real six `SERVICE_FAMILIES`, each linking to its
  actual route, using the locked promise text as the card copy.
- Hero headline/supporting copy/CTA and the Concierge's default quick-
  prompts/placeholder updated to the locked text (`AiConciergeDemo.tsx`
  — only its homepage-default props; service pages keep their own
  service-specific prompts, unaffected).
- Corrected the brand tagline site-wide: "Your trusted presence back
  home" (this repo's own prior invented variant) → "Your trusted rep
  back home" (the Messaging Guide's actual locked primary tagline,
  "Your Trusted Rep Back Home.") — footer, site header, service-page
  footer and the `<title>` tag, 5 files.
- `lib/services.ts`'s six `tagline` fields updated to the locked
  service-card promise text — same string now drives both the homepage
  cards and each service page's own H1, per the Master Services spec's
  "exact locked names everywhere" instruction.
- Verified: `tsc --noEmit` clean, `next build` clean, Vitest 17/17 green
  (homepage smoke test extended to assert all six real service names
  render, and to guard against both fabricated-stats regressions, not
  just the fabricated-testimonials one it already caught).

**Closed (17 Aug 2026):** Arrivals provider/booking availability (§4
above). `99_Supplemental/ASOJU_Arrivals_Service_Page_Blueprint_v1.1.docx`'s
locked arrangement-status state machine (`requested` → `being sourced` →
`awaiting confirmation` → `confirmed` → `changed`/`cancelled` →
`completed`) is now real: `ArrivalArrangement` (`backend/prisma/
schema.prisma`) + `arrival-arrangement-state-machine.ts` +
`POST`/`PATCH cases/:caseId/arrival-arrangements[/:id]` — staff-only
writes (no self-service vendor portal exists for ad hoc transport/
accommodation, so this is genuinely "backend/provider-authoritative": a
human coordinates off-platform and records the real state), customer
read-only. See README's own entry for the full behavioral detail
(required note on cancel/change, a change always re-requiring
confirmation rather than staying `CONFIRMED` against stale detail).
Covered by `backend/test/arrival.e2e-spec.ts`'s "Arrival arrangements"
block (8 tests).
