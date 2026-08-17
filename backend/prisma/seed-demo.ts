// Seeds realistic FAKE data for browsing/demoing the app — customers,
// properties, and service cases spread across statuses/verticals/pricing
// zones, plus the staff/field-agent accounts needed to drive them.
//
// Deliberately separate from seed.ts (the production bootstrap script):
// that one creates the *real* first admin/agent with a randomly generated,
// printed-once password, meant to be run once against a real deploy. This
// one creates obviously-synthetic accounts with a fixed, well-known
// password (never use this password for anything real), meant to be run
// against a dev/test/demo environment and re-run safely any number of
// times.
//
// Drives the real HTTP API wherever the real API has an endpoint for it —
// same "real app, no mocks" discipline as the e2e suite — and only drops
// to a direct Prisma write for the one thing no client-facing endpoint can
// do: flipping a Payment to PAID, which in real life only a verified
// Paystack webhook does (Non-Negotiable #4). That's the same "DB-shortcut
// past what's covered elsewhere" pattern refund.e2e-spec.ts's
// createPaidPayment helper already uses.
//
// Usage:
//   npm run seed:demo --workspace=backend
//     # against DATABASE_URL from backend/.env, HTTP calls to
//     # http://localhost:3001/api (the backend must be running)
//
//   SEED_BASE_URL=https://asoju-backend.onrender.com/api \
//   DATABASE_URL="<external Render connection string>" \
//     npm run seed:demo --workspace=backend
//     # against a remote deploy
//
// Idempotent: re-running skips any staff/customer account that already
// exists, and skips the whole case-building block if the first demo
// customer already has any cases (see `alreadySeeded` below) — safe to
// run more than once, won't create duplicates.
import 'dotenv/config';
import * as argon2 from 'argon2';
import { PrismaClient, Role, CaseTier } from '@prisma/client';

const prisma = new PrismaClient();

const BASE_URL = process.env.SEED_BASE_URL ?? 'http://localhost:3001/api';
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'AsojuDemo123!';

// ---------------------------------------------------------------------------
// HTTP helper — every case/quote/payment/evidence/QC action below goes
// through the real API, same as the app's own frontend would.
// ---------------------------------------------------------------------------

async function api<T = any>(path: string, opts: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new Error(`${opts.method ?? 'GET'} ${path} -> HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json as T;
}

async function login(email: string): Promise<string> {
  const res = await api<{ mfaRequired: boolean; mfaEnrollmentRequired?: boolean; accessToken?: string }>('/auth/login', {
    method: 'POST',
    body: { email, password: DEMO_PASSWORD },
  });
  if (res.mfaRequired || res.mfaEnrollmentRequired || !res.accessToken) {
    // Every account this script logs in as (CASE_MANAGER, QUALITY_CONTROL,
    // RELATIONSHIP_MANAGER, FIELD_AGENT, CUSTOMER) is deliberately outside
    // MFA_REQUIRED_ROLES (ADMIN/SUPER_ADMIN/FINANCE/COMPLIANCE_RISK) — if
    // this fires, an account got created with the wrong role.
    throw new Error(`${email} unexpectedly required MFA to log in — check its role`);
  }
  return res.accessToken;
}

// ---------------------------------------------------------------------------
// Staff accounts — direct Prisma, same shape as seed.ts's ensureAccount,
// but a fixed known password instead of a random printed-once one.
// ---------------------------------------------------------------------------

interface StaffSpec {
  label: string;
  email: string;
  role: Role;
  agentFullName?: string;
}

async function ensureStaff({ label, email, role, agentFullName }: StaffSpec) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`= ${label} already exists (${email})`);
    return existing;
  }
  const passwordHash = await argon2.hash(DEMO_PASSWORD);
  const created = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role,
      ...(agentFullName ? { agentProfile: { create: { fullName: agentFullName, city: 'Lagos', state: 'Lagos' } } } : {}),
    },
  });
  console.log(`+ created ${label} (${email})`);
  return created;
}

async function ensureCustomer(fullName: string, email: string, phone: string, country: string): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`= customer already exists (${email})`);
    return;
  }
  await api('/auth/register', {
    method: 'POST',
    body: { fullName, email, phone, password: DEMO_PASSWORD, countryOfResidence: country, preferredChannel: 'email' },
  });
  console.log(`+ registered customer ${fullName} (${email})`);
}

// ---------------------------------------------------------------------------
// Case-lifecycle helpers — thin wrappers over the real endpoints, mirroring
// the exact request shapes backend/test/*.e2e-spec.ts already use.
// ---------------------------------------------------------------------------

async function createServiceRequest(customerToken: string, rawDescription: string, location: string) {
  return api<{ id: string }>('/service-requests', {
    method: 'POST',
    token: customerToken,
    body: { rawDescription, location, channel: 'web' },
  });
}

async function convertRequest(
  staffToken: string,
  requestId: string,
  opts: { serviceType: string; description: string; location: string; priority?: string; tier?: string },
) {
  return api<{ id: string }>(`/service-requests/${requestId}/convert`, { method: 'POST', token: staffToken, body: opts });
}

async function transition(staffToken: string, caseId: string, toStatus: string) {
  return api(`/cases/${caseId}/transition`, { method: 'POST', token: staffToken, body: { toStatus } });
}

async function claimCase(staffToken: string, caseId: string) {
  return api(`/cases/${caseId}/claim`, { method: 'POST', token: staffToken });
}

async function createScope(staffToken: string, caseId: string, objective: string, tasks: string[], zone?: string) {
  return api(`/cases/${caseId}/scope`, { method: 'POST', token: staffToken, body: { objective, tasks, zone } });
}

async function confirmScope(customerToken: string, caseId: string) {
  return api(`/cases/${caseId}/scope/confirm`, { method: 'POST', token: customerToken });
}

async function createQuote(staffToken: string, caseId: string, lines: { category: string; label: string; amount: number }[]) {
  return api<{ id: string }>(`/cases/${caseId}/quotes`, { method: 'POST', token: staffToken, body: { lines } });
}

async function acceptQuote(customerToken: string, quoteId: string) {
  return api<{ id: string }>(`/quotes/${quoteId}/accept`, { method: 'POST', token: customerToken });
}

async function initiatePayment(customerToken: string, invoiceId: string) {
  return api(`/invoices/${invoiceId}/pay`, { method: 'POST', token: customerToken });
}

/** The one deliberate DB-shortcut — see the file header comment. Mirrors
 * exactly what CommerceService's real Paystack-webhook handler does on a
 * verified payment (paymentStatus -> PAID, and AWAITING_PAYMENT ->
 * SCHEDULED), since bypassing the webhook means bypassing that too. */
async function markPaid(caseId: string) {
  const invoice = await prisma.invoice.findFirstOrThrow({ where: { caseId }, orderBy: { createdAt: 'desc' } });
  const payment = await prisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
  await prisma.payment.update({ where: { id: payment.id }, data: { status: 'PAID' } });
  const kase = await prisma.serviceCase.update({ where: { id: caseId }, data: { paymentStatus: 'PAID' } });
  if (kase.status === 'AWAITING_PAYMENT') {
    await prisma.serviceCase.update({ where: { id: caseId }, data: { status: 'SCHEDULED' } });
    await prisma.caseStatusHistory.create({
      data: { caseId, fromStatus: 'AWAITING_PAYMENT', toStatus: 'SCHEDULED', reason: 'Payment verified (demo seed)' },
    });
  }
}

async function createAssignment(staffToken: string, caseId: string, agentId: string) {
  return api<{ id: string }>(`/cases/${caseId}/assignments`, {
    method: 'POST',
    token: staffToken,
    body: { role: 'FIELD_AGENT', agentId },
  });
}

async function acceptAssignment(agentToken: string, assignmentId: string) {
  return api(`/assignments/${assignmentId}/accept`, { method: 'POST', token: agentToken });
}

async function submitEvidence(agentToken: string, caseId: string, fileName: string) {
  const upload = await api<{ storageKey: string }>(`/cases/${caseId}/evidence/upload-url`, {
    method: 'POST',
    token: agentToken,
    body: { fileName, contentType: 'image/jpeg' },
  });
  return api(`/cases/${caseId}/evidence`, { method: 'POST', token: agentToken, body: { type: 'PHOTO', storageKey: upload.storageKey } });
}

async function completeFieldwork(agentToken: string, caseId: string) {
  return api(`/cases/${caseId}/evidence/complete`, { method: 'POST', token: agentToken });
}

async function performQc(qcToken: string, caseId: string, summary: string) {
  return api(`/cases/${caseId}/qc`, { method: 'POST', token: qcToken, body: { outcome: 'APPROVED', summary } });
}

async function approveCase(customerToken: string, caseId: string) {
  return api(`/cases/${caseId}/approvals`, { method: 'POST', token: customerToken, body: { action: 'APPROVED' } });
}

async function rateCase(customerToken: string, caseId: string, stars: number, comment: string, publicConsent: boolean) {
  return api(`/cases/${caseId}/rating`, { method: 'POST', token: customerToken, body: { stars, comment, publicConsent } });
}

async function createProperty(customerToken: string, address: string, city: string, state: string) {
  return api(`/me/properties`, { method: 'POST', token: customerToken, body: { address, city, state } });
}

async function subscribeToPlan(customerToken: string, plan: string) {
  return api(`/me/subscription`, { method: 'POST', token: customerToken, body: { plan } });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Seeding demo data against ${BASE_URL} ...\n`);

  // ---- Staff ----
  await ensureStaff({ label: 'admin (Ops Console, full access)', email: 'admin.demo@asoju.dev', role: Role.ADMIN });
  await ensureStaff({ label: 'finance (Finance Screen)', email: 'finance.demo@asoju.dev', role: Role.FINANCE });
  await ensureStaff({ label: 'case manager (triage/quoting)', email: 'casemanager.demo@asoju.dev', role: Role.CASE_MANAGER });
  await ensureStaff({ label: 'quality control (QC review)', email: 'qc.demo@asoju.dev', role: Role.QUALITY_CONTROL });
  await ensureStaff({ label: 'relationship manager (Concierge portfolio)', email: 'rm.demo@asoju.dev', role: Role.RELATIONSHIP_MANAGER });
  const agent1 = await ensureStaff({ label: 'field agent 1', email: 'agent1.demo@asoju.dev', role: Role.FIELD_AGENT, agentFullName: 'Ngozi Eze' });
  await ensureStaff({ label: 'field agent 2', email: 'agent2.demo@asoju.dev', role: Role.FIELD_AGENT, agentFullName: 'Tunde Bakare' });

  const caseManagerToken = await login('casemanager.demo@asoju.dev');
  const qcToken = await login('qc.demo@asoju.dev');
  const agent1Token = await login('agent1.demo@asoju.dev');
  const agent1Profile = await prisma.agent.findUniqueOrThrow({ where: { userId: agent1.id } });

  // ---- Customers (diaspora-flavored, realistic domains — Paystack
  // rejects .test-style addresses at checkout, see README) ----
  const customers = [
    { fullName: 'Chidinma Okafor', email: 'asoju.demo.chidinma@gmail.com', phone: '+447911123456', country: 'United Kingdom' },
    { fullName: 'Emeka Nwosu', email: 'asoju.demo.emeka@gmail.com', phone: '+12813305567', country: 'United States' },
    { fullName: 'Folake Adebayo', email: 'asoju.demo.folake@gmail.com', phone: '+14165557890', country: 'Canada' },
    { fullName: 'Ibrahim Sule', email: 'asoju.demo.ibrahim@gmail.com', phone: '+971501234567', country: 'United Arab Emirates' },
    { fullName: 'Grace Umeh', email: 'asoju.demo.grace@gmail.com', phone: '+4915112345678', country: 'Germany' },
  ];
  for (const c of customers) {
    await ensureCustomer(c.fullName, c.email, c.phone, c.country);
  }
  const tokens: Record<string, string> = {};
  for (const c of customers) {
    tokens[c.email] = await login(c.email);
  }
  const [chidinma, emeka, folake, ibrahim, grace] = customers.map((c) => tokens[c.email]);

  await createProperty(tokens[customers[0].email], '14 Admiralty Way, Lekki Phase 1', 'Lagos', 'Lagos');
  await createProperty(tokens[customers[1].email], 'Plot 22, Ring Road', 'Ibadan', 'Oyo');

  // ---- Cases — skip the whole block if this has already run once ----
  const alreadySeeded = await prisma.serviceCase.count({
    where: { customer: { user: { email: customers[0].email } } },
  });
  if (alreadySeeded > 0) {
    console.log('\nDemo cases already exist for the first demo customer — skipping case creation (safe re-run).');
  } else {
    console.log('\nBuilding demo cases...');

    // Case A — Chidinma, PROPERTY_INSPECTION, Lagos: full golden path to
    // COMPLETED with a public 5-star rating (shows up on /trust).
    {
      const req = await createServiceRequest(chidinma, 'Need a full inspection of a property before I commit to renting it out.', 'Lagos');
      const kase = await convertRequest(caseManagerToken, req.id, {
        serviceType: 'PROPERTY_INSPECTION',
        description: 'Full property inspection — structural, utilities, security — ahead of a rental listing.',
        location: 'Lekki Phase 1, Lagos',
        priority: 'STANDARD',
      });
      await transition(caseManagerToken, kase.id, 'SUBMITTED');
      await transition(caseManagerToken, kase.id, 'UNDER_REVIEW');
      await createScope(
        caseManagerToken,
        kase.id,
        'Inspect the property end-to-end and confirm it is rental-ready.',
        ['Exterior structural walkthrough', 'Interior room-by-room condition check', 'Plumbing and electrical test', 'Photograph every room'],
      );
      await confirmScope(chidinma, kase.id);
      const quote = await createQuote(caseManagerToken, kase.id, [
        { category: 'ASOJU_SERVICE_FEE', label: 'ASOJU inspection fee', amount: 65000 },
      ]);
      const invoice = await acceptQuote(chidinma, quote.id);
      await initiatePayment(chidinma, invoice.id);
      await markPaid(kase.id);
      const assignment = await createAssignment(caseManagerToken, kase.id, agent1Profile.id);
      await acceptAssignment(agent1Token, assignment.id);
      await submitEvidence(agent1Token, kase.id, 'front-elevation.jpg');
      await submitEvidence(agent1Token, kase.id, 'kitchen.jpg');
      await completeFieldwork(agent1Token, kase.id);
      await claimCase(qcToken, kase.id);
      await performQc(qcToken, kase.id, 'Property is rental-ready. No material defects found; minor cosmetic wear noted in the report.');
      await approveCase(chidinma, kase.id);
      await rateCase(chidinma, kase.id, 5, 'Incredibly thorough — felt like I was there myself. Exactly what I needed from abroad.', true);
      console.log(`  A. ${kase.id} — PROPERTY_INSPECTION — COMPLETED, rated 5* (public)`);
    }

    // Case B — Chidinma, BEREAVEMENT_SUPPORT, Lagos: left at QUOTED
    // (shows the URGENT default priority + a pending-review quote).
    {
      const req = await createServiceRequest(chidinma, 'My uncle passed away in Lagos and I need help coordinating the burial arrangements.', 'Lagos');
      const kase = await convertRequest(caseManagerToken, req.id, {
        serviceType: 'BEREAVEMENT_SUPPORT',
        description: 'Coordinate burial logistics and vendor arrangements on the family’s behalf.',
        location: 'Ikeja, Lagos',
      });
      await transition(caseManagerToken, kase.id, 'SUBMITTED');
      await transition(caseManagerToken, kase.id, 'UNDER_REVIEW');
      await createScope(caseManagerToken, kase.id, 'Coordinate vendors and logistics for the burial.', [
        'Liaise with the family and the church',
        'Coordinate caterer and canopy vendor',
        'Confirm burial ground arrangements',
      ]);
      await confirmScope(chidinma, kase.id);
      await createQuote(caseManagerToken, kase.id, [
        { category: 'ASOJU_SERVICE_FEE', label: 'ASOJU coordination fee', amount: 120000 },
        { category: 'EXTERNAL_COST', label: 'Vendor deposits (caterer, canopy)', amount: 350000 },
      ]);
      console.log(`  B. ${kase.id} — BEREAVEMENT_SUPPORT — QUOTED (urgent priority)`);
    }

    // Case C — Emeka, CONSTRUCTION_SUPERVISION, Ibadan (South-West zone):
    // paid and assigned, left IN_PROGRESS.
    {
      const req = await createServiceRequest(emeka, 'Supervising the construction of my duplex in Ibadan while I’m in Houston.', 'Ibadan');
      const kase = await convertRequest(caseManagerToken, req.id, {
        serviceType: 'CONSTRUCTION_SUPERVISION',
        description: 'Ongoing supervision of a duplex build — verify progress against the builder’s claims.',
        location: 'Bodija, Ibadan',
        priority: 'PRIORITY',
      });
      await transition(caseManagerToken, kase.id, 'SUBMITTED');
      await transition(caseManagerToken, kase.id, 'UNDER_REVIEW');
      await createScope(caseManagerToken, kase.id, 'Verify current build stage matches what the contractor has invoiced for.', [
        'Site visit and photo documentation',
        'Cross-check materials delivered against the BOQ',
        'Interview the site foreman',
      ]);
      await confirmScope(emeka, kase.id);
      const quote = await createQuote(caseManagerToken, kase.id, [
        { category: 'ASOJU_SERVICE_FEE', label: 'ASOJU supervision visit', amount: 80000 },
      ]);
      const invoice = await acceptQuote(emeka, quote.id);
      await initiatePayment(emeka, invoice.id);
      await markPaid(kase.id);
      const assignment = await createAssignment(caseManagerToken, kase.id, agent1Profile.id);
      await acceptAssignment(agent1Token, assignment.id);
      console.log(`  C. ${kase.id} — CONSTRUCTION_SUPERVISION — IN_PROGRESS (South-West zone)`);
    }

    // Case D — Folake, FAMILY_SUPPORT, CONCIERGE tier: subscribes to
    // Priority first, so the quote visibly carries the membership discount.
    {
      try {
        await subscribeToPlan(folake, 'PRIORITY');
      } catch (err) {
        if (!String(err).includes('Already subscribed')) throw err;
      }
      const req = await createServiceRequest(folake, 'Please check in on my mother in Lagos and arrange her monthly grocery run.', 'Lagos');
      const kase = await convertRequest(caseManagerToken, req.id, {
        serviceType: 'FAMILY_SUPPORT',
        description: 'Monthly welfare check-in and grocery run for an elderly parent.',
        location: 'Surulere, Lagos',
        tier: CaseTier.CONCIERGE,
      });
      await transition(caseManagerToken, kase.id, 'SUBMITTED');
      await transition(caseManagerToken, kase.id, 'UNDER_REVIEW');
      await createScope(caseManagerToken, kase.id, 'Welfare check-in and grocery provisioning.', [
        'Home visit and welfare check',
        'Grocery shopping to the family’s list',
        'Photo + written update to the family',
      ]);
      await confirmScope(folake, kase.id);
      const quote = await createQuote(caseManagerToken, kase.id, [
        { category: 'ASOJU_SERVICE_FEE', label: 'ASOJU Concierge visit', amount: 40000 },
      ]);
      const invoice = await acceptQuote(folake, quote.id);
      await initiatePayment(folake, invoice.id);
      console.log(`  D. ${kase.id} — FAMILY_SUPPORT (Concierge) — AWAITING_PAYMENT, membership discount applied`);
    }

    // Case E — Ibrahim, PROPERTY_INSPECTION, Abuja (Other zone): fresh,
    // left at SUBMITTED — an incoming case for the ops triage queue.
    {
      const req = await createServiceRequest(ibrahim, 'Want an inspection done on some land I’m considering buying in Abuja.', 'Abuja');
      const kase = await convertRequest(caseManagerToken, req.id, {
        serviceType: 'PROPERTY_INSPECTION',
        description: 'Land inspection ahead of a purchase decision — verify boundaries and any encumbrances.',
        location: 'Gwarinpa, Abuja',
      });
      await transition(caseManagerToken, kase.id, 'SUBMITTED');
      console.log(`  E. ${kase.id} — PROPERTY_INSPECTION — SUBMITTED (Other zone, untriaged)`);
    }

    // Case F — Grace, PROPERTY_INSPECTION, Lagos: completed with a private
    // (publicConsent: false) 3-star rating — the deliberate contrast to
    // Case A, proving consent actually gates the /trust page.
    {
      const req = await createServiceRequest(grace, 'Need someone to check on an apartment I own in Lagos that’s been vacant.', 'Lagos');
      const kase = await convertRequest(caseManagerToken, req.id, {
        serviceType: 'PROPERTY_INSPECTION',
        description: 'Vacancy check on an owned apartment — confirm condition and security.',
        location: 'Yaba, Lagos',
      });
      await transition(caseManagerToken, kase.id, 'SUBMITTED');
      await transition(caseManagerToken, kase.id, 'UNDER_REVIEW');
      await createScope(caseManagerToken, kase.id, 'Confirm the apartment is secure and undamaged.', [
        'Exterior and interior walkthrough',
        'Check all locks and windows',
        'Photograph current condition',
      ]);
      await confirmScope(grace, kase.id);
      const quote = await createQuote(caseManagerToken, kase.id, [{ category: 'ASOJU_SERVICE_FEE', label: 'ASOJU inspection fee', amount: 55000 }]);
      const invoice = await acceptQuote(grace, quote.id);
      await initiatePayment(grace, invoice.id);
      await markPaid(kase.id);
      const assignment = await createAssignment(caseManagerToken, kase.id, agent1Profile.id);
      await acceptAssignment(agent1Token, assignment.id);
      await submitEvidence(agent1Token, kase.id, 'apartment-door.jpg');
      await completeFieldwork(agent1Token, kase.id);
      await claimCase(qcToken, kase.id);
      await performQc(qcToken, kase.id, 'Apartment is secure, no signs of forced entry or damage. Minor dust accumulation noted.');
      await approveCase(grace, kase.id);
      await rateCase(grace, kase.id, 3, 'Fine, but took longer than I expected to hear back.', false);
      console.log(`  F. ${kase.id} — PROPERTY_INSPECTION — COMPLETED, rated 3* (private — not on /trust)`);
    }

    // Case G — Emeka, ASSET_INSPECTION, Lagos: scoped and confirmed, left
    // at UNDER_REVIEW awaiting a quote. (LEGAL_DOCUMENT_SERVICES was the
    // first choice here, but it requires a verified Power of Attorney on
    // file — VERIFIED_POA_REQUIRED_SERVICE_TYPES in cases.service.ts —
    // which is its own real flow, out of scope for this seed.)
    {
      const req = await createServiceRequest(emeka, 'Need someone to check on a generator I own that’s in storage in Lagos.', 'Lagos');
      const kase = await convertRequest(caseManagerToken, req.id, {
        serviceType: 'ASSET_INSPECTION',
        description: 'Condition check on a stored generator ahead of a possible sale.',
        location: 'Apapa, Lagos',
      });
      await transition(caseManagerToken, kase.id, 'SUBMITTED');
      await transition(caseManagerToken, kase.id, 'UNDER_REVIEW');
      await createScope(caseManagerToken, kase.id, 'Confirm the asset’s condition and working order.', [
        'Visual condition inspection',
        'Power-on functionality test',
        'Photograph the asset and its storage condition',
      ]);
      await confirmScope(emeka, kase.id);
      console.log(`  G. ${kase.id} — ASSET_INSPECTION — UNDER_REVIEW, scoped (awaiting quote)`);
    }
  }

  // ---- Summary ----
  console.log('\nDone. Demo accounts (all share one password):');
  console.log(`  password: ${DEMO_PASSWORD}\n`);
  console.log('  Staff:');
  console.log('    admin.demo@asoju.dev        ADMIN');
  console.log('    finance.demo@asoju.dev      FINANCE');
  console.log('    casemanager.demo@asoju.dev  CASE_MANAGER');
  console.log('    qc.demo@asoju.dev           QUALITY_CONTROL');
  console.log('    rm.demo@asoju.dev           RELATIONSHIP_MANAGER');
  console.log('    agent1.demo@asoju.dev       FIELD_AGENT (Ngozi Eze)');
  console.log('    agent2.demo@asoju.dev       FIELD_AGENT (Tunde Bakare, unused so far)');
  console.log('  Customers:');
  for (const c of customers) console.log(`    ${c.email.padEnd(28)} ${c.fullName}`);
  console.log(
    '\nNote: ADMIN/FINANCE have mandatory MFA (see auth.service.ts) — this script never logs in as them for that reason; log in through the UI to enroll.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
