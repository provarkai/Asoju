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

### Phase 1 — Pricing Engine foundation (Track A, no AI)
- New models: `PriceBook`, `PriceRule`, `MultiplierRule`, `ExternalCostRule`,
  `DiscountRule` (fields per the target spec's tables — service/workflow
  scoping, condition sets, effective-date versioning, priority ordering).
- New service: given a confirmed `CaseScope` + service/workflow, resolve
  applicable rules deterministically and return `QuoteLine[]` — same shape
  `CommerceService.createQuote` already accepts, so this can plug in as an
  alternative to (or pre-fill for) the current hand-typed `lines` DTO
  without restructuring `Quote`/`QuoteLine` themselves.
- Admin CRUD for price books/rules (staff-facing, per `§35 Admin controls`
  — this is real net-new admin surface, not just backend logic).
- Traceability: quote needs a `priceBookVersion`/rule-reference field it
  doesn't have today (extend `Quote`, don't replace it).
- Reproducibility test: same scope + same price-book version always
  produces the same quote, and changing the *current* price book never
  changes a *historical* quote.

### Phase 2 — Escalation + Idempotency infrastructure (shared by A and B)
- New `Escalation` entity (customer-safe `reason_category`, restricted
  `internal_reason`, staff handoff summary, assignment) — needed before
  Track B can exist, but also immediately useful today wherever staff
  currently field ad-hoc "this doesn't fit the normal flow" cases.
- New `IdempotencyRecord` mechanism for consequential operations (case
  creation, payment initiation) — a real gap independent of automation;
  worth having even if Track B never ships.
- Minimal feature-flag/kill-switch mechanism (`AutomationCapability.enabled`
  at minimum) — nothing elaborate, but *something* has to exist before any
  automation is safe to turn on per-service.

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

## 5. Open decisions (yours, not mine to guess)

1. **`StructuredRequest` vs. `ServiceRequest`** — extend the existing
   model with the richer fields, or add `StructuredRequest` as a new,
   separate model that later converts into a `ServiceRequest`/`Case`? The
   existing 46 e2e specs and every current staff-triage screen read
   `ServiceRequest` directly, so this has real blast-radius implications
   either way.
2. **How far to automate at launch.** The spec's own maturity model goes
   to A5; my recommendation above is Phase 3 lands eligibility
   *decisioning* without yet acting on it, and Phase 4 starts with exactly
   one low-complexity workflow behind a kill switch. Confirm that's the
   right level of caution for a first cut, or if a narrower/wider start is
   wanted.
3. **Anonymous Concierge access** — this scope makes the existing P0 gap
   (`FRONTEND_HANDOFF_V1_GAP_MAP.md` §2) more central: the target flow
   explicitly wants the AI to "prepare the complete case and quote before
   asking the customer to authenticate." That's a bigger anonymous-surface
   decision than just "let them chat" — it means draft `StructuredRequest`
   and even draft pricing exist before any authentication. Needs its own
   sign-off, not an inherited assumption.
4. **Retention policy for anonymous/Concierge data** — the source spec
   explicitly declines to define this ("a product/legal/security policy
   decision," `§29`). Needed before Phase 3, since `StructuredRequest`
   and `ConciergeSession` both hold pre-auth customer data.
5. **Admin UI scope for Phase 1** — price-book/rule management needs a
   real staff-facing screen (not just backend CRUD endpoints) for the
   pricing engine to be usable by Finance/Ops. Worth confirming this rides
   along with Phase 1 rather than being deferred, since a pricing engine
   nobody can configure isn't actually replacing the manual process.

---

## 6. What this scope deliberately does not include

No code, no schema, no migrations. No commitment to build order beyond
"Phase 1 before Phase 3 before Phase 4." No answer to the five open
questions above — those need your call before Phase 1 gets a real ticket.
