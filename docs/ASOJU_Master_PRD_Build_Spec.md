# ASOJU — Master Product Requirements Document
## Diaspora Support & Trusted Execution Platform
### Developer Build Specification (v2.0 — Merged & Consolidated)

**Prepared for:** Development team / Claude Code build agent
**Status:** Implementation-ready
**Supersedes:** Original real-estate lead-gen PRD (retained as MVP Vertical #1 inside ASOJU)

---

## 0. How to Use This Document

This PRD merges two prior documents into one implementation-ready spec:

1. The original **AI Real Estate Lead-Generation PRD** (WhatsApp AI qualification bot, scoring logic, system prompt, phased rollout) — this is preserved almost entirely, but reframed as **ASOJU Verify → Property Inspection**, the first of three MVP services, not the whole company.
2. The **ASOJU Master PRD** (16 strategic gates covering business foundation, trust architecture, economics, product architecture, legal/regulatory, GTM, technology stack, UX, data/security architecture, and implementation roadmap).

Everything below is organized the way a build team (human or AI coding agent) needs it: **business context → data model → module specs → workflows → AI system design → non-negotiables → build backlog**. Sections are self-contained enough that a developer/agent can build one module at a time by reading only the relevant section plus Section 3 (Data Model) and Section 10 (Non-Negotiables).

---

## 1. Executive Summary

**Brand:** ASOJU
**Category:** Diaspora Support & Remote Execution Platform
**Brand promise:** *Your trusted presence back home.*
**Core mechanism:** AI orchestrates intake and coordination → the platform enforces deterministic workflow and permissions → verified human agents/professionals execute physical/professional work → evidence proves what happened → the customer approves and stays in control.

ASOJU helps Nigerians living abroad (initially UK, USA, Canada) verify, manage, and execute important tasks in Nigeria without being physically present — starting with three services (Property Inspection & Verification, Construction/Project Supervision, Asset/Project Inspection) and expanding over time into a full diaspora operations layer (family support, procurement, business verification, investment/agriculture support).

**Not a real-estate company.** Real estate/property is the entry vertical because it best demonstrates the core value proposition (trust + physical presence + evidence), not the identity of the business.

**Build philosophy (locked):** Concierge-first. Start as an operationally excellent service business with a lightweight software layer; automate only what's been proven manually. AI-assisted rapid development (Option B) — use AI coding tools + managed third-party services, but the domain model, security, and financial controls are engineered deliberately, not vibe-coded.

---

## 2. Business Foundation

| Decision | Locked Direction |
|---|---|
| Core market | Nigerians living abroad |
| Initial geography (customer acquisition) | UK → USA → Canada |
| Initial geography (operations) | Limited, dense Nigerian locations (start Lagos + environs) — never advertise coverage the operations network can't support |
| Core problem solved | Trusted execution in Nigeria while the customer is physically absent |
| Brand promise | "Your trusted presence back home." |
| Category description | "Diaspora Support Platform" |
| Primary buyer | Individual diaspora customer |
| Secondary buyers | Diaspora families, property owners/investors, entrepreneurs |
| Associations / Nigerian businesses | Distribution/partnership channels, not initial core customers |
| Pricing model | **Two-tier**: ASOJU Essential (pay-per-service, AI-led) + ASOJU Concierge (subscription, relationship-managed) |
| MVP hypothesis | "Will Nigerians abroad pay ASOJU to physically verify, inspect, or supervise something important in Nigeria — and trust it enough to return?" |

### 2.1 What NOT to build in MVP
Full family-care marketplace, full procurement marketplace, full investment marketplace, emergency-response network, multi-country operations, white-label SaaS, complex subscription ecosystem, automated financial/escrow infrastructure, dozens of service categories, native iOS/Android apps, proprietary wallet/escrow.

---

## 3. Core Data Model

This is the canonical schema shape. The **Service Case** is the central object — every request, regardless of vertical, becomes a Case, and everything else attaches to it.

```
users                    -- all human accounts (customer, agent, provider, staff)
roles / permissions
customers
beneficiaries            -- e.g. customer's parents/family being helped
accounts                 -- optional grouping for family/organisation use

properties
assets                   -- generalized: farm, business premises, equipment, vehicle

service_requests         -- raw inbound request (pre-case)
service_cases            -- THE CENTRAL OBJECT
case_tasks
case_status_history
case_risk_flags

agents                   -- field agents
providers                -- professionals (surveyors, lawyers, engineers, valuers)
provider_credentials
assignments               -- links case <-> agent/provider

documents
evidence                 -- photos, videos, docs, observations, metadata
reports                  -- customer-facing deliverable

quotes
invoices
payments
refunds
payouts                  -- to agents/providers

messages
notifications

complaints
incidents
audit_events             -- append-only, immutable

subscriptions            -- Concierge memberships
memberships

ai_interactions           -- structured log of AI conversations/actions
approvals                 -- human/customer approval events
```

### 3.1 The Service Case object (canonical shape)

```json
{
  "case_id": "ASJ-000184",
  "customer_id": "CUST-1029",
  "service_type": "PROPERTY_INSPECTION | CONSTRUCTION_SUPERVISION | ASSET_INSPECTION",
  "description": "string",
  "location": "string",
  "priority": "STANDARD | PRIORITY | URGENT",
  "risk_level": "1 | 2 | 3 | 4",
  "tier": "ESSENTIAL | CONCIERGE",
  "status": "<see state machine 5.2>",
  "assigned_agent_id": "AGT-042",
  "provider_ids": ["PRV-011"],
  "quote_id": "QT-2201",
  "payment_status": "PENDING | PAID | REFUNDED",
  "evidence_ids": ["EVD-001", "EVD-002"],
  "report_id": "RPT-0091",
  "approvals": [{"by": "customer", "at": "timestamp", "action": "APPROVED"}],
  "risk_flags": [],
  "audit_history": ["<append-only events>"],
  "created_at": "iso8601",
  "updated_at": "iso8601"
}
```

### 3.2 Case state machine (deterministic, backend-enforced — AI may recommend but never force a transition)

```
Draft → Submitted → Under Review → Quoted → Awaiting Payment →
Scheduled → Assigned → In Progress → Evidence Submitted →
Quality Control → Customer Review → (Additional Work / Approved) →
Completed → Closed
```
Every state has: owner, required action, entry criteria, exit criteria, SLA clock.

---

## 4. User Roles

| Role | Access Scope |
|---|---|
| Customer | Own profile, own cases, own beneficiaries/assets |
| Beneficiary | Only explicitly authorised information |
| Field Agent | Assigned cases/tasks only (case-scoped, not role-wide) |
| Professional Provider | Assigned professional work only, case-scoped |
| Relationship Manager (RM) | Assigned customer portfolio (Concierge tier) |
| Case Manager / Operations | Operational cases they own or are escalated |
| Quality Control (QC) | Evidence/reports pending review |
| Finance | Financial records |
| Compliance/Risk | Incident and audit data relevant to investigations |
| Admin | Controlled platform administration |
| Super Admin | Full technical access, MFA + extra logging required |

**Access control = Role-Based (RBAC) + Case-Level (relationship-scoped).** An agent with the "Field Agent" role must additionally be assigned to a specific case to see it — role membership alone is never sufficient.

---

## 5. Platform Modules (7 Product Surfaces)

Build order should roughly follow this list, per the vertical-slice methodology in Section 11.

### 5.1 Customer Portal (Web/PWA)
Home screen asks: *"What would you like us to handle for you in Nigeria?"*

**P0 screens:**
- Registration / login (email, phone/OTP; MFA optional for customers, mandatory for staff)
- Onboarding: name, country of residence, phone/email, preferred channel only — nothing more up front (progressive disclosure)
- Service request (natural-language entry point, routes through AI Concierge)
- Case dashboard: active cases, action-required items, recent reports, payments awaiting approval
- Case detail page: status in human language (not internal state codes), timeline, assigned agent, evidence viewer, messages, report
- Evidence viewer: photos/videos/docs tagged to the checklist item they support
- Report viewer: leads with findings, not case metadata
- Payment: quote → checkout → receipt
- Approval actions: Approve / Request clarification / Request additional work / Escalate

**P1:** Saved properties/assets, multiple beneficiaries, recurring inspection scheduling, service history, ratings, referral flow, notification preferences.

**P2:** Full "My Nigeria" asset portfolio, family management dashboard, personal AI assistant, multi-country support.

### 5.2 AI Diaspora Concierge
The front door. Replaces the narrower real-estate qualification bot from the original PRD — same underlying design pattern (structured intake → scored/classified → CRM record → human handoff), generalized across all ASOJU services. Full spec in **Section 7**.

### 5.3 Operations Control Centre (internal dashboard)
Mission control for staff. **P0:**
- Case queue: new / active / overdue / awaiting payment / awaiting assignment / awaiting QC / escalations
- Case management: assign, reassign, add tasks/notes, change priority, escalate, review evidence, approve reports
- Agent & provider management
- Payment/incident visibility

### 5.4 Field Agent App (mobile web/PWA — not native in MVP)
- Job list ("today's assignments")
- Job card: instructions, location, checklist, contact person, required evidence, restrictions
- Workflow: Accept → Navigate → Check-in (timestamp + location) → Execute checklist → Capture evidence → Submit → Escalate exceptions
- Offline support (P1): local queue for checklist/evidence capture, auto-sync on reconnect — agents must never lose evidence to poor connectivity

### 5.5 Professional/Provider Portal
- Onboarding: identity, service category, location, credentials, references
- Job flow: view scope → accept/reject → submit quote (if applicable) → upload evidence → submit report → track payment
- Case-scoped access only — a provider never sees the customer's full profile, only what's needed for their assignment

### 5.6 Trust & Evidence Engine (cross-cutting infrastructure, not a screen)
Full spec in **Section 8**.

### 5.7 Admin & Finance Console
User/provider/agent management, service configuration, pricing, geographic coverage, risk rules, AI configuration, content/FAQ, payment settings, audit logs, system health.

---

## 6. MVP Service Catalogue (the only three services active at launch)

### Service 1 — Property Inspection & Verification
**Customer says:** "I found this land/property. Go and check it."
**Scope:** Confirm physical location, inspect visible condition, photograph access road/surroundings, capture site video, record observations, collect available documents presented, identify discrepancies, produce report.
**Explicit exclusions (must be stated to customer):** Not a legal title certification, not a survey certification, not a valuation, not a structural engineering assessment. Those require an appropriately qualified professional coordinated through the platform.

### Service 2 — Construction / Project Supervision
**Customer says:** "I'm building in Nigeria. I need someone to monitor the project."
**Scope:** Scheduled site visits (recurring), progress documentation, contractor observations, materials/work verification, photo/video evidence, progress report, exception alerts.
**This is the first recurring-revenue product** — each visit produces comparable before/after evidence.

### Service 3 — Asset / Project Inspection
**Customer says:** "I can't be there. Go and check this for me."
Deliberately extends beyond real estate: house, farm, business premises, equipment, vehicle, agricultural project, commercial asset.
**Deliverable:** Inspection → Evidence → Report → Recommendation.

Every service must have a standard specification before it goes live: name, customer problem, scope, deliverables, SLA, required personnel, required evidence, pricing method, risk level, professional requirements, exclusions, escalation conditions.

### 6.1 Standard Field Checklist Pattern (example — Property Inspection)
```
☐ Confirm location
☐ Photograph entrance / access road
☐ Photograph surrounding development
☐ Photograph the property
☐ Capture site video
☐ Record observations
☐ Collect available documents
☐ Identify exceptions
☐ Complete inspection submission
```
Every service gets its own version of this pattern.

---

## 7. AI System Design

### 7.1 Design principles
- First response to a customer message must arrive in under 10 seconds.
- Max 6 questions before a handoff decision — progressive disclosure, not a form disguised as chat.
- Tone: warm, concierge-style, never robotic ("Step 1 of 6" language is banned).
- AI must disclose it is AI within its first 2 messages. Never let the customer believe they're speaking to a human.
- Escalate immediately on: explicit request for a human, high-value signals (multiple properties, ₦100M+/$150k+), frustration/confusion, or any off-script legal/title question.

### 7.2 WhatsApp / Web Conversation Flow (Property Inspection example — generalize the pattern per service)

**Message 1 — Greeting + AI disclosure**
> "Hi! 👋 Thanks for reaching out to ASOJU. I'm the AI Concierge — I'll ask a few quick questions so we can get the right people handling this for you. Takes about 2 minutes. Sound good?"

**Message 2 — Understand the ask (open-ended, not multiple choice)**
> "What would you like us to handle for you in Nigeria?"
Customer replies in natural language (e.g., "I found a piece of land in Ibeju-Lekki and I'm not sure whether it's genuine. Can you check it?"). AI classifies: service type, location, risk signal, customer intent, human-involvement requirement.

**Message 3 — Location / segment**
> "Got it. Where are you currently based? This helps us coordinate timing and communication."

**Message 4 — Scope-specific detail**
Ask only what's missing for that specific service (property address, current construction stage, asset type, etc.)

**Message 5 — Timeline / urgency**
> "What's your ideal timeline — do you need this handled urgently, within a couple of weeks, or are you just exploring for now?"

**Message 6 — Close + handoff**
> "Perfect — I'm putting together your service quote now. One of our team will confirm scope and next steps within [X hours]. In the meantime, here's how our verification process works: [link]"

### 7.3 Escalation triggers
| Trigger | Action |
|---|---|
| "I want to speak to a human" | Stop script, confirm handoff, notify RM immediately |
| High-value signal (multiple assets, large budget) | Flag VIP, notify senior RM/Concierge team |
| Frustration/confusion/repetition | Apologize once, escalate immediately, no lengthy re-explanation |
| Legal/title-specific question | Answer only with the approved verification-status language, flag for RM/legal follow-up — never improvise |
| 24h no reply mid-conversation | Do not resume qualification on re-engagement; single check-in message, route to nurture |

### 7.4 Scoring Logic (deterministic — NOT another LLM call)

Applied post-conversation once required fields are collected. Kept deterministic and auditable, separate from the LLM's conversational judgment.

```python
score = 0

# Budget/value fit (35 pts)
if stated_value >= service_price_band: score += 35
elif stated_value >= service_price_band * 0.8: score += 20
else: score += 5

# Urgency/timeline (30 pts)
if timeline == "immediate": score += 30
elif timeline == "near_term": score += 18
else: score += 5

# Commitment signal — financing/payment method (20 pts)
if payment_method == "cash_ready": score += 20
elif payment_method == "diaspora_payment_plan": score += 14
else: score += 8

# Engagement quality (15 pts) — LLM-assessed 0-15 sub-score
score += engagement_subscore

if score >= 75: tag = "Hot"
elif score >= 45: tag = "Warm"
else: tag = "Cold"
```

| Score | Tag | Routing |
|---|---|---|
| 75–100 | 🔥 Hot | Human notified instantly, target first response < 2 hours |
| 45–74 | 🟡 Warm | AI nurture drip (3–5 day cadence), human review within 24h |
| 0–44 | ⚪ Cold | Long-cycle nurture, no RM assignment until re-engagement |

**Segment tag (parallel, non-scored):** Diaspora / Local HNI / Mass Retail — determines nurture content and RM specialization.

**Feedback loop:** Every closed case is tagged back to its original AI-assigned score. Monthly review compares score distribution to actual outcomes; rebalance weights if e.g. "Warm" and "Hot" convert similarly. Any case that closed despite a "Cold" tag gets a manual review to find the missing signal.

### 7.5 LLM System Prompt (production-ready template)

```
SYSTEM PROMPT — ASOJU AI Concierge

ROLE
You are the AI Concierge for ASOJU, a diaspora support platform helping
Nigerians abroad get important things handled in Nigeria — property
inspections, construction supervision, asset inspections, and related
services. You are the first point of contact. Your job is to understand
what the customer needs, collect the minimum necessary information, and
hand off to a human team member. You are NOT a closer, legal advisor,
surveyor, valuer, or negotiator.

TONE
Warm, concise, concierge-style. Natural language, 1 emoji per message max,
never robotic ("Step 1 of 6" is banned). Mirror the customer's formality.

DISCLOSURE RULE
Identify yourself as AI within your first message. Never let the customer
believe they are speaking to a human. If asked directly, confirm honestly.

CONVERSATION GOAL
Understand the request in the customer's own words first. Then collect
only what's missing:
1. What do they need handled? (service type, inferred from free text)
2. Location (city/state in Nigeria + customer's country of residence)
3. Scope-specific detail (property address / construction stage / asset type)
4. Timeline / urgency
5. Any other missing info required for that specific service

After collecting what's needed, confirm next steps and hand off to a human
team member. Do not attempt to negotiate scope or price yourself.

ESCALATION RULES (override the script immediately)
- Explicit request for a human: stop, confirm handoff, notify team, do not
  ask further questions.
- Multiple assets/high value signals: flag VIP, notify senior team.
- Frustration/confusion/repetition: apologize once briefly, escalate
  immediately, do not re-explain the process at length.
- Legal/title-specific questions beyond general verification-process
  explanation: answer only with the approved general language, flag for
  human/legal follow-up. Never speculate on legal, ownership, or
  professional matters.
- 24h+ gap mid-conversation: do not resume qualification questions on
  re-engagement; send a single light check-in and route to nurture.

BOUNDARIES — NEVER DO THE FOLLOWING
- Never certify property title, legal ownership, or survey status.
- Never guarantee investment returns or property value.
- Never quote, negotiate, or imply flexibility on price.
- Never ask for BVN, NIN, passport numbers, or bank account details —
  identity verification happens later, with a human, through a secure
  workflow.
- Never claim an inspection happened when it didn't.
- Never invent evidence, credentials, or professional conclusions.
- Never send more than one question per message.

OUTPUT FORMAT
Return a structured JSON object alongside your conversational reply, for
case/CRM logging:
{
  "reply_text": "<message to send>",
  "data_collected": {
    "service_type": "<string or null>",
    "location": "<string or null>",
    "scope_detail": "<string or null>",
    "timeline": "<immediate | near_term | exploring | null>",
    "payment_method": "<cash_ready | diaspora_plan | financing | null>"
  },
  "escalate": "<none | human_requested | vip | frustration | legal_question>",
  "conversation_complete": "<true | false>",
  "engagement_subscore": "<0-15 integer>"
}
The JSON is stripped before sending the visible message to the customer.
```

### 7.6 AI Architecture (system boundary, not just prompt design)

```
Customer
   ↓
Conversation Layer
   ↓
Intent Router
   ↓
Customer + Case Context Retrieval
   ↓
Policy / Guardrail Engine   ← deterministic rules, not LLM judgment
   ↓
LLM (produces structured ACTION, not direct DB writes)
   ↓
Validation
   ↓
Workflow Engine (deterministic state machine)
   ↓
Database
```

**Tool-based AI actions** (each has permission requirements, input validation, output restrictions, audit logging):
`get_case_status`, `get_case_report`, `create_case`, `request_quote`, `schedule_service`, `send_customer_update`, `request_human_handoff`.

**AI Action Levels:**
| Level | Meaning |
|---|---|
| 0 — Inform | AI answers from approved knowledge |
| 1 — Assist | AI drafts/recommends |
| 2 — Execute low-risk action | AI performs predefined, validated actions |
| 3 — Human approval required | High-value payment, beneficiary change, professional determination, disputed case closure |

**AI must never independently:** certify title, make legal conclusions, guarantee returns, approve high-value payments, override operational controls, invent evidence, declare a case complete without required evidence.

---

## 8. Trust & Evidence Architecture

### 8.1 Four questions every case must be able to answer
Who did it? Were they qualified? What were they asked to do? Where/when did they do it? What evidence did they produce? Who reviewed it? What remains uncertain? What did the customer approve?

### 8.2 Trust labels (never a single vague "Verified" badge)
| Label | Meaning |
|---|---|
| ASOJU Verified | Identity/process verified by ASOJU |
| Professionally Reviewed | A qualified professional reviewed it |
| Customer Provided | Information came from the customer |
| Third-Party Statement | Information came from another party (e.g. seller) |
| Not Independently Verified | No independent confirmation yet |

### 8.3 Evidence levels — never conflate these
1. **Observed** — "The agent physically observed X."
2. **Reported** — "The seller/provider stated X."
3. **Professionally assessed** — "A qualified professional assessed X."
4. **Platform verified** — "ASOJU completed its defined verification procedure for X."

### 8.4 Evidence object
```
evidence_id, case_id, task_id, uploader_id, timestamp (server-side),
type (photo|video|document|voice|location|note), description,
location_metadata (if applicable), review_status, integrity_hash
```
Chain of custody: Captured → Uploaded → Stored (private object storage, not predictable URLs) → Reviewed → Approved/Rejected → Included in report → Delivered to customer. Original evidence must remain in the audit trail even if later corrected/replaced.

### 8.5 Quality Control (QC)
A field submission is never automatically a completed case. QC checks: completeness (checklist done?), evidence (required media present?), consistency (observations match evidence?), scope (agent stayed in bounds?), exceptions properly reported, report quality. Outcomes: **Approved / Rework / Escalate / Incident**.

### 8.6 Case Confidence display (never a misleading single percentage)
```
Identity: Complete
Physical inspection: Complete
Documents: Partial
Professional review: Pending
Outstanding issues: 2
```

---

## 9. Legal, Regulatory & Financial Guardrails

*(Design-gate level — final compliance framework requires review by Nigerian counsel and relevant licensed professionals before public launch. This is not legal advice.)*

- **ASOJU's legal position:** a technology-enabled coordination and execution platform — not a law firm, surveying firm, valuation firm, engineering consultancy, or (until appropriately licensed/structured) an estate agency in every jurisdiction it operates.
- **Property services:** Lagos has a state-level Estate Agency regulatory framework; before offering brokerage/transaction-facilitation services in any state, determine whether ASOJU is acting as an estate agent and whether licensing is required. MVP should stay in inspection/verification/coordination, not brokerage.
- **Customer funds:** ASOJU does **not** hold third-party transaction funds or build its own escrow/wallet in MVP. Service payments flow through a licensed third-party payment provider. High-value/regulated transactions route through an appropriate regulated/legal financial partner.
- **Data protection:** Nigeria Data Protection Act 2023 / NDPC framework applies. Build data inventory, privacy notice, lawful-processing basis, consent management, data minimisation, retention rules, data-subject request workflow, breach-response procedure, and processor agreements as P0, not post-launch additions. Assess cross-border transfer obligations given customers are abroad (UK/US/Canada) while data is processed in Nigeria.
- **Sensitive identifiers:** Never ask for BVN, NIN, passport numbers, or bank account details through the AI conversation flow.
- **Professional liability:** the platform coordinates; the qualified professional (surveyor, lawyer, engineer, valuer) remains responsible for their professional opinion. ASOJU must never rewrite a professional's opinion into a stronger claim.
- **Marketing language:** never say "100% fraud-proof," "guaranteed safe investment," "guaranteed title," "we eliminate all risk." Use precise, evidence-based language instead ("Verified according to our stated verification process").
- **Insurance:** assess public liability, professional indemnity (where applicable), field-agent incident cover, errors & omissions, and cyber/data-breach cover before scaling.
- **Corporate structure:** operate through a properly incorporated Nigerian entity (CAC-registered), maintain standard corporate governance records.

---

## 10. Non-Negotiables (write these into the dev team's brief verbatim)

1. No case without a customer.
2. No assignment without an authorised workflow.
3. No high-risk conclusion without appropriate human/professional review.
4. No payment status based solely on customer screenshots — only the payment provider's verified webhook status drives workflow.
5. No important evidence without case association.
6. No sensitive access without permission (case-scoped, not just role-scoped).
7. No report that hides unresolved issues.
8. No AI claim presented as verified fact.
9. AI cannot independently move a case between critical states — only the deterministic workflow engine can, based on validated triggers.
10. Audit records are append-only.

---

## 11. Development Approach & Build Sequence

### 11.1 Architecture philosophy
AI-native, workflow-driven, API-first, evidence-centric — but not over-engineered. **Modular monolith** for MVP (not microservices); extract services only when scale/team structure justifies it.

```
/backend
   /auth
   /customers
   /beneficiaries
   /cases
   /tasks
   /agents
   /providers
   /properties
   /evidence
   /documents
   /payments
   /notifications
   /ai
   /trust
   /reports
   /analytics
   /audit
```

### 11.2 Recommended stack
| Layer | Choice |
|---|---|
| Frontend | Next.js + TypeScript |
| Customer app | Responsive Web/PWA first — no native apps in MVP |
| Backend | Node.js + TypeScript (NestJS or similarly structured framework) |
| API | REST initially |
| Database | PostgreSQL |
| Cache/queue | Redis |
| File storage | Secure private object storage (never predictable public URLs) |
| AI | LLM API (Claude) + structured outputs + retrieval, tool-based actions |
| Auth | Managed authentication provider, MFA for staff/admin |
| WhatsApp | Official WhatsApp Business API via provider (Twilio/360dialog) |
| Payments | Licensed payment gateway (Paystack/Flutterwave for NGN; appropriate partner for GBP/USD/CAD) |
| Maps | Third-party mapping API |
| Reporting | HTML/PDF generation |
| Hosting | Managed cloud, CI/CD via Git |

**Explicitly do not build:** payment processor, escrow system, identity verification infra, maps, LLM foundation model, email infra, WhatsApp infra, cloud storage, authentication system. Proprietary IP = Case Engine + Trust Engine + Evidence System + Operations Console + AI orchestration.

### 11.3 Build in vertical slices, not horizontal layers
| Slice | Outcome |
|---|---|
| 1. Request → Case | Real conversation becomes a structured case with no manual re-entry |
| 2. Case → Quote → Payment | Payment status automatically updates the case |
| 3. Payment → Assignment | No case lost between payment and execution |
| 4. Assignment → Field Execution | Complete evidence package lands in the case |
| 5. Evidence → QC | No incomplete evidence reaches the customer |
| 6. QC → Report | Customer understands the result without needing the agent to explain it |
| 7. Report → Repeat/Monitoring | First transaction naturally creates the second opportunity |

### 11.4 Phased Roadmap

| Phase | Timing | Focus |
|---|---|---|
| 0 — Foundation | Weeks 1–2 | Legal entity, brand, SOPs, architecture, DB schema, auth |
| 1 — Concierge MVP | Weeks 3–6 | 3 services live, mostly-manual assignment/QC, AI intake working |
| 2 — Controlled Pilot | Weeks 7–10 | 25–50 real paid cases, referral/community acquisition only |
| 3 — Operational Product | Months 3–4 | Dashboard, agent app, assignment engine, payments automation |
| 4 — Trust & Automation | Months 5–6 | Provider verification, evidence integrity, AI report assistant, fraud flags |
| 5 — Concierge & Recurring | Months 7–9 | Subscription tier live, recurring monitoring schedules |
| 6 — Scale | Months 10–12 | Geographic/service expansion only after proof |

### 11.5 Launch Gates (do not skip)
- **Gate A — Internal Ready:** systems work internally.
- **Gate B — Pilot Ready:** legal + security + operations + provider network ready.
- **Gate C — First Customer:** first paid case successfully completed.
- **Gate D — Repeatable:** 10–25 cases completed with stable process.
- **Gate E — Product-Market Signal:** customers return/refer, unit economics work.
- **Gate F — Scale:** only then increase acquisition spend and geography.

**No-Go conditions (block scaling regardless of calendar date):** critical security vulnerability, evidence can be manipulated, cases being lost, agents routinely missing SLA, core services losing money, unresolved complaints, inconsistent provider quality, AI producing material misinformation, unresolved legal/regulatory requirement.

---

## 12. Feature Priority (P0/P1/P2)

**P0 — required for MVP:**
Customer registration/profile, AI Concierge, service request, case engine + state machine, operations dashboard, agent management, field-agent workflow, checklist, evidence capture/storage, QC workflow, report generation, customer report viewer, quote, payment, notifications, audit log, basic provider verification, basic RBAC + case-scoped access.

**P1 — immediately after MVP validation:**
WhatsApp AI integration (if not already P0), beneficiaries, saved assets/properties, recurring services, provider performance scoring, advanced provider portal, referral system, Concierge workflow, advanced analytics, multi-provider coordination, document vault, customer service history.

**P2 — platform expansion:**
Family support, procurement, business verification, investment support, agriculture support, advanced risk engine, personal AI assistant, full subscription engine, corporate accounts, partner portal.

**P3 — platformisation (later):**
White-label, public APIs, multi-country support, marketplace, SaaS billing, partner ecosystem, predictive analytics.

---

## 13. Success Metrics

| Category | Metrics |
|---|---|
| Customer | Acquisition, completion rate, repeat rate, referral rate, satisfaction |
| Operations | SLA compliance, evidence completeness, QC pass rate, rework rate, incident rate |
| Financial | Revenue, gross margin, contribution margin, CAC, LTV, LTV:CAC ratio |
| Trust | Disputes, fraud incidents, provider incidents, report corrections |
| AI | Escalation accuracy, human override rate, hallucination incidents, task completion rate |

**North Star metric:** *Successful Customer Cases* — customer requested something → ASOJU executed it → evidence/QC completed → customer accepted the result. Track successful cases per active customer.

---

## 14. First 100 Customers — Learning Objectives

Treat the first 100 customers as a structured learning cohort, not just revenue:
1. Which service sells easiest?
2. Which customer segment pays fastest?
3. Which acquisition channel actually works (referral/community/content/paid)?
4. What's the real average spend?
5. What causes complaints vs. referrals?
6. What's the true cost per case (vs. assumed)?
7. Do customers prefer Essential or Concierge?
8. Is the AI actually saving operational time, and where does it fail?

---

## 15. Summary — What Makes This Work

The system compounds results three ways:
1. **Speed** — AI qualification means a real conversation becomes a routed, scored case within minutes, not days.
2. **Trust at scale** — verification labels, evidence chain of custody, and QC remove the #1 objection (fraud fear) without a human manually reassuring every lead.
3. **Focus** — human time goes only to cases that need human judgment; deterministic workflow and AI handle the repeatable 80%.

The long-term moat is not the chatbot — it's the accumulated trusted network, operational data, evidence history, and customer relationships that are structurally difficult to replicate.
