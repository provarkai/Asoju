# Automation Eligibility + Pricing Engine — Scope

This is a **scoping document, not an implementation plan**. Nothing here is
built. It answers: what does the target architecture actually require,
what already exists that it can reuse, what's genuinely net-new, and what
decisions need your sign-off before any of it is scheduled.

Source docs: `docs/v2.0-engineering-specs/ASOJU_AI_Concierge_Automation_
Technical_Specification_v2.0.docx` (behavior/rules) and
`ASOJU_Database_Data_Model_Specification_v2.0.docx` (the 32-entity target
schema, including field-level tables the doc's plain-text headings don't
show — extracted in full for this document). Continues from
`docs/FRONTEND_HANDOFF_V1_GAP_MAP.md` §5.

---

## 1. What the target architecture actually is

Two engines plus a decision gate between them, feeding a new orchestration
layer on top of the existing case pipeline:

```
Concierge conversation
  → StructuredRequest (objective/location/timing/subject/requirements)
  → Automation Eligibility Decision  ──AUTO──►  Case creation (automated)
        │                                              │
        ├─ CUSTOMER_INPUT → ask for more info          ▼
        ├─ ESCALATE / UNSUPPORTED / BLOCKED       CaseScope (confirmed)
        │        │                                      │
        │        ▼                                      ▼
        │   Escalation (staff handoff)          Pricing Engine
        │                                    (PriceBook/PriceRule/
        │                                     MultiplierRule/
        │                                     ExternalCostRule/
        │                                     DiscountRule)
        │                                              │
        │                                              ▼
        │                                        Quote (versioned,
        │                                     traceable to rule versions)
        │                                              │
        │                                              ▼
        │                                   Customer acceptance → Payment
        │                                    (server-confirmed, AI never
        │                                     marks payment successful)
        └──────────────────────────────────────────────┘
                  (either path can still escalate)
```

Non-negotiable rules the spec is explicit and repetitive about (worth
carrying forward regardless of how the rest is scoped): **AI cannot write
DB records directly, invent or override prices, mark payments successful,
or bypass configured escalation — every consequential action goes through
a typed, re-authorized backend tool, and every automated decision is
audited.** These aren't new principles for this codebase (the existing
`AiActionLevel` enum already encodes `HUMAN_APPROVAL_REQUIRED` as a
concept) — they're a stricter, more granular version of the same instinct.

---

## 2. What already exists (reuse, don't rebuild)

| Target concept | Real backend equivalent | Gap |
|---|---|---|
| `AutomationDecision` (AUTO/CUSTOMER_INPUT/ESCALATE/UNSUPPORTED/BLOCKED) | `AiInteraction.actionLevel` (`INFORM/ASSIST/EXECUTE_LOW_RISK/HUMAN_APPROVAL_REQUIRED`) + `AiInteraction.escalation` (`NONE/HUMAN_REQUESTED/VIP/FRUSTRATION/LEGAL_QUESTION`) | Coarser, no rule/config versioning, no per-service eligibility conditions, not currently gating anything — it's descriptive metadata on an interaction record, not a decision that controls what happens next. |
| `StructuredRequest` | `ServiceRequest` (`rawDescription: String`, `location: String?`, `serviceType?`) | Flat/unstructured. No `objective/subject/timing/requirements/deliverable/missing_information` shape, no draft/ready/converted/expired lifecycle. |
| Automated case creation | `CasesController#createServiceRequest` → **staff-only** `convertToCase` (`STAFF_TRIAGE_ROLES`) | 100% manual triage today. Zero automated/AI-triggered path exists. |
| Deterministic pricing engine | **Does not exist.** `POST /cases/:caseId/quotes` (`CommerceService.createQuote`) takes staff-supplied `lines: {label, amount, category}[]` directly — a human types every amount. | This is the single biggest gap. `GET /cases/:caseId/regional-pricing-hint` and the `predictive-costing` module are advisory/analytics for staff, not an authoritative calculator that produces quote lines. No `PriceBook`/`PriceRule`/`MultiplierRule`/`ExternalCostRule`/`DiscountRule` of any kind. |
| Quote traceability/versioning | `Quote`/`QuoteLine` — has categorized lines (`ASOJU_SERVICE_FEE/EXTERNAL_COST/THIRD_PARTY_PROFESSIONAL/TAX_STATUTORY`), scope-version link, FX lock, membership discount/SC | No `status` lifecycle (Draft/Issued/Accepted/Rejected/Expired — today it's just a nullable `acceptedAt`), no price-book/rule-version reference. |
| `Escalation` entity | Closest analogues: `Dispute` (post-completion only), `IncidentSeverity`/`IncidentStatus` (agent-side incidents) | Nothing pre-case-creation. No customer-safe reason category, no staff handoff summary, no assignment. |
| `IdempotencyRecord` | Not found anywhere in the codebase. | Case creation and payment initiation have no idempotency-key mechanism today (relying on it being staff-driven and rare). |
| Feature flags / kill switches | Not found anywhere in the codebase. | The whole rollout strategy (`§37`, `§35 Admin controls`) assumes per-service/per-workflow flags that don't exist yet. |
| Scope confirmation gate | `ScopeService` (`GET/POST /scope`, `POST /scope/confirm`) — already enforces "quote requires confirmed scope" | **This one's essentially already built** and matches the target `CaseScope` model closely. |
| Anonymous Concierge access | Doesn't exist — `POST /api/ai/concierge/message` requires an authenticated customer today | Same P0 gap already flagged in `FRONTEND_HANDOFF_V1_GAP_MAP.md` §2 — this architecture makes it *more* load-bearing, since the whole automated flow assumes the AI can build a case and quote before the customer authenticates. |

**Bottom line: nothing in the target automation/pricing architecture is a
refactor. It's a new subsystem sitting in front of a mostly-compatible
existing case/scope/quote/payment spine.** The spine (Case, CaseScope,
Quote, QuoteLine, Payment, categorized line types, FX lock) is real and
worth keeping; the decision-making and price-calculation *logic* in front
of it doesn't exist yet.

---

## 3. Two separable tracks

The spec bundles "AI eligibility decisioning" and "deterministic pricing"
into one architecture, but they don't have to ship together, and I'd
recommend they don't:

**Track A — Pricing Engine (no AI involved).** A deterministic calculator:
confirmed `CaseScope` → resolve `PriceRule`s from an active `PriceBook` →
apply `MultiplierRule`s → add `ExternalCostRule` costs → apply
`DiscountRule`s → produce `QuoteLine[]`. This is valuable **on its own**,
today, called by a staff member instead of them hand-typing amounts — it
doesn't require the AI/automation layer to exist first. It's also lower
risk to build and test in isolation (pure calculation, deterministic
inputs/outputs, no conversational/LLM surface).

**Track B — Automation Eligibility Engine.** `AutomationCapability` +
`AutomationRule` + `AutomationDecision`, wired into the Concierge, gating
whether a `StructuredRequest` can become a `Case` (and later a `Quote`)
without staff triage. This is the higher-stakes piece — it's what actually
removes the human from the loop — and it depends on Track A already
existing and being trustworthy (an AI-triggered quote is only as safe as
the calculator producing it).

Building A first, proving it out with real staff usage, then building B on
top of a pricing engine that's already been exercised in production is
the lower-risk sequencing. Building B first (AI decides eligibility, but
pricing is still a human typing numbers) doesn't remove any manual work —
it just adds an AI gatekeeper in front of the same bottleneck.

---

## 4. Phase breakdown

### Phase 1 — Pricing Engine foundation (Track A, no AI) — ✅ backend done
- New models: `PriceBook`, `PriceRule`, `MultiplierRule` (migration
  `20260815000000_pricing_engine`). `ExternalCostRule`/`DiscountRule`
  stayed deliberately unbuilt — no real external-cost or discount logic
  exists yet to migrate, and `DiscountRule` as spec'd would overlap with
  the membership discount/SC system `CommerceService`/`MembershipService`
  already compute separately; reconciling the two needs its own decision,
  not a guess folded into this pass.
- `PricingEngineService.calculateServiceFeeLine` — migrates the one real,
  already-approved pricing decision in the codebase
  (`commerce/regional-pricing.ts`'s `BASE_RATE_USD`: Lagos $50,
  South-West $80, 1.5x urgency multiplier, from the Platform Expansion
  PRD) from hardcoded TypeScript into admin-configurable rows. Returns a
  discriminated `{ok:true, ...}` / `{ok:false, reason}` result rather
  than throwing for "no price configured" (OTHER zone, or an unpriced
  service/zone pair) — an expected outcome, not a server error, matching
  `getRegionalPricingHint`'s existing "null rather than a guessed
  number" contract.
- `GET /cases/:caseId/pricing-preview` (new `pricing-engine` module,
  same shape as `predictive-costing`'s case-scoped controller) — a
  preview only. Staff still submit the result (or their own numbers)
  through the existing `POST /cases/:caseId/quotes`, now accepting an
  optional `priceBookId` for traceability.
- Admin CRUD (`FINANCE_ROLES`, `/admin/pricing/price-books[...]`) — only
  backend endpoints, no frontend admin screen yet (Phase 1's open
  decision #5, resolved this way for the first cut: a calculator usable
  by staff via the API today is real, incremental value over hand-typed
  amounts even before a polished UI exists; the UI is a fair follow-up
  ticket, not a blocker).
- `Quote.priceBookId` (nullable, `SetNull` on delete) — set only when a
  quote's lines came from the calculator; untouched for the (currently
  most common) fully-manual quote. Existing `regional-pricing-hint`
  endpoint and `predictive-costing` module were left exactly as they
  were — this is additive, not a replacement made in the same pass.
- 14 new e2e tests (`test/pricing-engine.e2e-spec.ts`) + full existing
  e2e suite (47 suites) reverified clean against real Postgres.

**Not done in Phase 1, and deliberately not started:** `ExternalCostRule`,
`DiscountRule`, any AI/automation wiring (Track B, Phases 3–5), and a
staff-facing admin *screen* for price-book management (only the backend
endpoints exist).

### Phase 2 — Escalation + Idempotency infrastructure (shared by A and B) — ✅ done (15 Aug 2026)
- New `Escalation` entity (`EscalationReasonCategory`, `EscalationStatus`,
  customer-safe `customerMessage` vs. restricted `internalReason`/
  `handoffSummary`, `assignedToId`) — needed before Track B can exist, but
  also immediately useful today wherever staff currently field ad-hoc
  "this doesn't fit the normal flow" cases. `POST /cases/:caseId/escalations`
  (ops roles, `CaseAccessGuard`), `GET /cases/:caseId/escalations` (customer
  + staff, curated field-level view for the customer — never
  `internalReason`/`handoffSummary`/`assignedToId`), `GET /escalations`
  (staff triage queue, optional `?status=`), `GET /escalations/:id` (staff
  full detail), `POST /escalations/:id/{assign,resolve,cancel}`. Every
  mutation audited (`escalation.created`/`.assigned`/`.resolved`/`.cancelled`).
- New `IdempotencyRecord` mechanism (`IdempotencyService.begin/complete/fail`,
  keyed on `[operation, idempotencyKey, actorId]`) for consequential
  operations — a real gap independent of automation; worth having even if
  Track B never ships. Wired into `POST /service-requests` and
  `POST /invoices/:invoiceId/pay` via an optional `Idempotency-Key` header —
  a client that omits it gets exactly the pre-existing behaviour. Race-safe:
  two concurrent requests with the same brand-new key resolve to one 201 and
  one 409 (Postgres's unique constraint arbitrates, not an app-level lock);
  a replayed key after success returns the original result rather than
  reprocessing (payment replay returns `{ reference, replay: true }` with no
  `authorizationUrl`, since Paystack's hosted-checkout URL is only ever
  handed back once and isn't persisted).
- 20 new e2e tests (`test/escalation.e2e-spec.ts`, `test/idempotency.e2e-spec.ts`)
  + full existing e2e suite (49 suites) reverified clean against real
  Postgres (aside from the pre-existing, unrelated, rotating
  `connect ECONNRESET` flakiness `test/jest-e2e.setup.ts` already documents).

**Not done in Phase 2, and deliberately not started:** the
`AutomationCapability.enabled` feature-flag/kill-switch mentioned in this
section's original scope. That flag has nothing to gate yet —
`AutomationCapability` itself is a Phase 3 model. Building a bare `enabled`
column with no consumer now would be scaffolding, not infrastructure;
it's deferred to land as part of Phase 3, alongside the model it actually
switches.

### Phase 3 — Structured Request + Eligibility Decision (Track B, part 1)
- New `StructuredRequest` model (richer than `ServiceRequest` — decide via
  the open question in §5 below whether it replaces or sits alongside it).
- `AutomationCapability` + `AutomationRule` + `AutomationDecision` models
  and the deterministic rule-evaluation service.
- Wire the *eligibility check* into the existing Concierge/service-request
  flow — but resolve **AUTO** at first to "still requires staff convert,"
  i.e. land the decision-making and audit trail without yet removing the
  human from case creation. This proves the eligibility logic against real
  traffic before anything acts on it autonomously.

### Phase 4 — Automated case creation (Track B, part 2)
- Only once Phase 3's eligibility decisions have been observed against
  real requests: let an `AUTO` decision actually invoke case creation
  through a typed, idempotent tool instead of falling through to staff
  triage. Behind a kill switch, enabled per-service/per-workflow, starting
  with the single lowest-complexity service/workflow the spec itself
  suggests (Verify or Assist's "repeatable procurement task" per its own
  `§34` test scenarios), not all six at once.

### Phase 5 — Automated payment boundary (A4, later still)
- The spec's own maturity model treats this as the highest-risk rung.
  Nothing in this scope proposes building it in the same pass as Phases
  1–4 — flagged here only so it's visible as the eventual, not immediate,
  target.

---

## 5. Open decisions — all resolved (15 Aug 2026)

1. **`StructuredRequest` vs. `ServiceRequest`** — **resolved: extend
   `ServiceRequest`.** Add the Concierge-generated fields (`objective`,
   `subject`, `timing`, `requirements`, `missingInformation`, etc. —
   nullable/additive) directly onto the existing model rather than
   introducing a parallel one. It's the same real object (raw lead →
   convert → case) just enriched, not a genuinely different thing, and
   this avoids a second model the 46 existing e2e specs and every
   staff-triage screen would need to be kept in sync with.
2. **How far to automate at launch.** — **resolved: decide, don't act
   yet.** Phase 3 lands eligibility decisioning (`AUTO`/`CUSTOMER_INPUT`/
   `ESCALATE`/`UNSUPPORTED`/`BLOCKED`) and audits every decision against
   real traffic; every case still goes through staff triage exactly as
   today. Phase 4 (letting `AUTO` actually create a case, one
   low-complexity workflow at a time behind a kill switch) only starts
   once Phase 3's decisions have been observed and trusted in practice —
   not bundled into the same pass.
3. **Anonymous Concierge access** — **resolved: chat only, no structured
   data pre-auth.** Fixes the P0 gap from `FRONTEND_HANDOFF_V1_GAP_MAP.md`
   §2 (anonymous visitors get a real AI conversation instead of today's
   scripted demo) without taking on the source spec's full ambition of a
   complete draft case + price existing before authentication. No
   `StructuredRequest` (i.e. no enriched `ServiceRequest` fields per
   decision #1) or pricing preview is generated until the customer signs
   in — smaller anonymous attack/abuse surface to secure, and the
   anonymous-endpoint auth-relaxation work from Sprint 0's gap-map §2 can
   stay scoped to conversation only.
4. **Retention policy for anonymous/pre-auth Concierge data** —
   **resolved: conservative engineering default, not a final policy.**
   Anonymous/unconverted `ConciergeSession` (and any future enriched
   `ServiceRequest` fields that never convert) auto-delete after 30 days;
   once a session converts to a real `ServiceRequest`/`Case`, it keeps
   that record's existing retention (indefinite, same as every other case
   today). This is a placeholder pending real legal/compliance review, not
   a decision made with that authority — flag it for that review before
   this is treated as final policy.
5. **Admin UI scope for Phase 1** — resolved for the first cut: backend
   CRUD only (`/admin/pricing/price-books[...]`), no frontend screen yet.
   Finance/Ops can configure it via the API today; a real staff-facing
   screen is a fair, separate follow-up ticket once someone's actually
   using the API version day-to-day. Revisit if that turns out to be too
   much friction in practice.

All five decisions are now resolved — Phase 2 (Escalation + Idempotency
infrastructure) and Phase 3 (Structured Request + Eligibility Decision,
per decisions #1 and #3 above) are ready to be scoped into real tickets
whenever you want to proceed.

---

## 6. What this scope deliberately does not include

No code, no schema, no migrations. No commitment to build order beyond
"Phase 1 before Phase 3 before Phase 4." No answer to the five open
questions above — those need your call before Phase 1 gets a real ticket.
