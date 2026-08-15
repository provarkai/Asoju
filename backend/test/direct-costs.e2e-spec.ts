import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { PaymentStatus, Role } from '@prisma/client';

/**
 * P0 Technology & Platform Requirements Specification v1.0 §33 "Financial
 * & Analytics Requirements" — "Contribution = Revenue - Direct Case
 * Costs; Contribution Margin % = Contribution / Revenue." `Payout` has
 * existed in the schema with no caseId and zero call sites — nothing
 * recorded what a case actually cost to deliver. Real app, real Postgres.
 */
describe('Direct case costs and contribution margin', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let finance: Awaited<ReturnType<typeof createStaff>>;
  let caseManager: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;
  let financeToken: string;
  let caseManagerToken: string;

  /** Builds a case through to a PAID Payment of the given amount (NGN),
   * returning the caseId — mirrors refund.e2e-spec.ts's fast-forward. */
  async function createPaidCase(amount: number): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Direct cost test case', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);
    const caseId = caseRes.body.id;

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
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ objective: 'Inspect', tasks: ['Visit site'] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope/confirm`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    const quoteRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/quotes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [{ category: 'ASOJU_SERVICE_FEE', label: 'ASOJU service fee', amount }] })
      .expect(201);
    const acceptRes = await request(app.getHttpServer())
      .post(`/api/quotes/${quoteRes.body.id}/accept`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);
    const invoiceId = acceptRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/invoices/${invoiceId}/pay`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);

    const payment = await prisma.payment.findFirstOrThrow({ where: { invoiceId } });
    await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });

    // The admin who triaged it isn't a CaseCollaborator (ADMIN bypasses
    // CaseAccessGuard instead) — give Finance real case access the same
    // way Ops actually would, so tests exercise the real guard.
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/claim`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(201);

    return caseId;
  }

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();

      [customer, admin, finance, caseManager] = await Promise.all([
        createCustomer('directcost'),
        createStaff('directcost-admin', Role.ADMIN),
        createStaff('directcost-finance', Role.FINANCE),
        createStaff('directcost-cm', Role.CASE_MANAGER),
      ]);
      [customerToken, adminToken, financeToken, caseManagerToken] = await Promise.all([
        login(app, customer.email),
        login(app, admin.email),
        login(app, finance.email),
        login(app, caseManager.email),
      ]);

    });
  });

  // See test/utils/bootstrap.ts's ensureHealthyApp — recovers from a
  // wedged shared `app` before the next test runs instead of letting a
  // mid-file connection reset poison every later test in this file.
  beforeEach(async () => {
    app = await ensureHealthyApp(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('blocks a case manager (non-Finance) from recording or listing direct costs', async () => {
    const caseId = await createPaidCase(50000);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/direct-costs`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ category: 'TRAVEL', amount: 5000 })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/direct-costs`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .expect(403);
  });

  it('rejects a non-positive amount', async () => {
    const caseId = await createPaidCase(50000);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/direct-costs`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ category: 'TRAVEL', amount: 0 })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/direct-costs`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ category: 'TRAVEL', amount: -100 })
      .expect(400);
  });

  it('lets Finance record multiple direct costs against a case, listed newest first, audited', async () => {
    const caseId = await createPaidCase(50000);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/direct-costs`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ category: 'REPRESENTATIVE', amount: 8000, note: 'Field agent day rate' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/direct-costs`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ category: 'TRAVEL', amount: 3000 })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/direct-costs`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    expect(list.body).toHaveLength(2);
    expect(list.body.map((c: { category: string }) => c.category).sort()).toEqual(['REPRESENTATIVE', 'TRAVEL']);

    const events = await prisma.auditEvent.findMany({
      where: { caseId, action: 'case.direct_cost_recorded' },
    });
    expect(events).toHaveLength(2);
  });

  it('feeds into AnalyticsService contribution/contribution-margin exactly (revenue - direct costs)', async () => {
    const before = await request(app.getHttpServer())
      .get('/api/analytics/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const revenueBefore = before.body.financial.revenueByCurrency.NGN ?? 0;
    const costBefore = before.body.financial.directCostsByCurrency.NGN ?? 0;

    const caseId = await createPaidCase(100000);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/direct-costs`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ category: 'THIRD_PARTY', amount: 15000 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/direct-costs`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ category: 'OTHER', amount: 5000 })
      .expect(201);

    const after = await request(app.getHttpServer())
      .get('/api/analytics/summary')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const revenueAfter = after.body.financial.revenueByCurrency.NGN;
    const costAfter = after.body.financial.directCostsByCurrency.NGN;

    // This case's known contribution: 100,000 revenue - 20,000 direct cost.
    expect(revenueAfter - revenueBefore).toBe(100000);
    expect(costAfter - costBefore).toBe(20000);

    const contributionAfter = after.body.financial.contributionByCurrency.NGN;
    expect(contributionAfter).toBe(revenueAfter - costAfter);
    const marginAfter = after.body.financial.contributionMarginByCurrency.NGN;
    expect(marginAfter).toBeCloseTo(contributionAfter / revenueAfter, 10);
  });
});
