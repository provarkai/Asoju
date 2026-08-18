import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role, VaultCategory } from '@prisma/client';

/**
 * docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 4 — CommerceService.autoQuoteIfEligible,
 * triggered from ScopeController right after a customer confirms scope.
 * Uses LEGAL_DOCUMENT_SERVICES as the pilot service type in these tests
 * specifically because it's the one ServiceType no other e2e spec file
 * already registers an AutomationCapability for (avoids the unique-
 * constraint collisions a shared test DB across spec files would
 * otherwise hit) — it happens to also require a verified Power of
 * Attorney (VERIFIED_POA_REQUIRED_SERVICE_TYPES), which these tests set
 * up directly, exercising that guard inside CasesService.autoConvert too.
 */
describe('Auto-quote on scope confirmation (Phase 4)', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let customerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();
      [customer, admin] = await Promise.all([createCustomer('auto-quote'), createStaff('auto-quote-admin', Role.ADMIN)]);
      [customerToken, adminToken] = await Promise.all([login(app, customer.email), login(app, admin.email)]);

      // Once for the whole file — AutomationCapability.serviceType is
      // globally unique, and every test here shares the same pilot
      // service type by design (see the file-level comment above).
      const capRes = await request(app.getHttpServer())
        .post('/api/admin/automation/capabilities')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ serviceType: 'LEGAL_DOCUMENT_SERVICES', enabled: true })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/admin/automation/capabilities/${capRes.body.id}/rules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kind: 'REQUIRED_FIELDS', config: { fields: ['objective', 'timing', 'location'] } })
        .expect(201);
    });
  });

  beforeEach(async () => {
    app = await ensureHealthyApp(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /** Real, end-to-end AUTO conversion — reuses the exact pipeline a
   * Concierge conversation or a customer's own service-request would go
   * through, rather than hand-inserting an AutomationDecision row, so
   * these tests exercise the real join CommerceService.autoQuoteIfEligible
   * relies on (ServiceCase.originRequest.automationDecision.outcome). */
  async function createAutoConvertedCase(): Promise<string> {
    // A fresh PoA per call — a customer with one already-verified PoA on
    // file satisfies the guard regardless of how many exist, and each
    // test in this file creates its own case needing this.
    await prisma.verifiedAsset.create({
      data: { customerId: customer.customer.id, type: VaultCategory.POWER_OF_ATTORNEY, name: 'PoA', verified: true },
    });

    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Auto-quote test request', channel: 'web', serviceType: 'LEGAL_DOCUMENT_SERVICES' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/service-requests/${reqRes.body.id}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ objective: 'Prepare a power of attorney document', timing: 'This week', location: 'Lagos, Nigeria' })
      .expect(200);

    const requestRow = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: reqRes.body.id } });
    expect(requestRow.convertedCaseId).not.toBeNull(); // Part 4's own coverage already proves the mechanism; sanity-check it here too
    return requestRow.convertedCaseId!;
  }

  async function moveToUnderReview(caseId: string) {
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ toStatus: 'SUBMITTED' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ toStatus: 'UNDER_REVIEW' })
      .expect(201);
  }

  async function draftScope(caseId: string) {
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ objective: 'Prepare the requested document', tasks: ['Draft document', 'Notarize'] })
      .expect(201);
  }

  async function seedActivePriceBook(): Promise<string> {
    const bookRes = await request(app.getHttpServer())
      .post('/api/admin/pricing/price-books')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currency: 'USD' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/pricing/price-books/${bookRes.body.id}/activate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/pricing/price-books/${bookRes.body.id}/price-rules`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'LEGAL_DOCUMENT_SERVICES', zone: 'LAGOS', value: 120, label: 'Legal document service fee' })
      .expect(201);
    return bookRes.body.id;
  }

  // Runs before any test in this file activates a PriceBook — matches
  // pricing-engine.e2e-spec.ts's own established pattern (its first test
  // is the same "nothing active yet" case, for the same reason): once
  // any test activates a book, PriceBook.active has no per-test reset
  // (no deactivate endpoint exists), so "no pricing" only reliably means
  // that if it runs first.
  it('confirming scope on an AUTO-converted case with no active pricing leaves it exactly as today — no quote, still UNDER_REVIEW', async () => {
    const caseId = await createAutoConvertedCase();
    await moveToUnderReview(caseId);
    await draftScope(caseId);
    // Deliberately no seedActivePriceBook() call — nothing priced.

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope/confirm`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    const serviceCase = await prisma.serviceCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(serviceCase.status).toBe('UNDER_REVIEW');

    const quote = await prisma.quote.findFirst({ where: { caseId } });
    expect(quote).toBeNull();
  });

  it('confirming scope on an AUTO-converted, priced case generates a real quote with no staff action', async () => {
    const caseId = await createAutoConvertedCase();
    await moveToUnderReview(caseId);
    await draftScope(caseId);
    const priceBookId = await seedActivePriceBook();

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope/confirm`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    const serviceCase = await prisma.serviceCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(serviceCase.status).toBe('QUOTED');

    const quote = await prisma.quote.findFirstOrThrow({ where: { caseId } });
    expect(Number(quote.amount)).toBe(120 * 1600); // $120 at the default 1600 NGN/USD rate
    expect(quote.priceBookId).toBe(priceBookId);

    const lines = await prisma.quoteLine.findMany({ where: { quoteId: quote.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0].category).toBe('ASOJU_SERVICE_FEE');

    const auditRow = await prisma.auditEvent.findFirst({ where: { caseId, action: 'quote.auto_generated' } });
    expect(auditRow?.actorType).toBe('system');
  });

  it('never auto-quotes an ordinary staff-triaged case, even in a fully priced zone — staff still submit the quote themselves', async () => {
    // No AutomationCapability at all for PROCUREMENT in this test file —
    // this case is triaged by a human from end to end, the same as every
    // case created before this feature existed.
    const bookRes = await request(app.getHttpServer())
      .post('/api/admin/pricing/price-books')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currency: 'USD' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/pricing/price-books/${bookRes.body.id}/activate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/pricing/price-books/${bookRes.body.id}/price-rules`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROCUREMENT', zone: 'LAGOS', value: 60, label: 'Procurement fee' })
      .expect(201);
    const priceBookId = bookRes.body.id;

    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Ordinary staff-triaged request', location: 'Lagos, Nigeria', channel: 'web' })
      .expect(201);

    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROCUREMENT', description: 'Ordinary staff-triaged case', location: 'Lagos, Nigeria' })
      .expect(201);
    const caseId = caseRes.body.id;

    await moveToUnderReview(caseId);
    await draftScope(caseId);

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope/confirm`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    const serviceCase = await prisma.serviceCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(serviceCase.status).toBe('UNDER_REVIEW'); // never auto-transitioned to QUOTED

    const quote = await prisma.quote.findFirst({ where: { caseId } });
    expect(quote).toBeNull();
    expect(priceBookId).toBeTruthy(); // pricing genuinely was available — this wasn't a false negative
  });
});
