import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * ASOJU Platform Database Schema & ERD Design v1.0 Section 10 / API
 * Specification v1.0 Section 40 "Critical Business Rules" — "Quote has
 * validity... Expired quotes cannot release execution." `Quote.expiresAt`
 * existed in the schema with nothing ever setting or checking it. Real
 * app, real Postgres.
 */
describe('Quote expiry', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let finance: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;
  let financeToken: string;


  /** Builds a fresh case through to a just-issued quote, returning both
   * the caseId and quoteId. */
  async function createQuotedCase(): Promise<{ caseId: string; quoteId: string }> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Quote expiry test case', location: 'Lagos', channel: 'web' })
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
      .send({ lines: [{ category: 'ASOJU_SERVICE_FEE', label: 'ASOJU service fee', amount: 50000 }] })
      .expect(201);

    return { caseId, quoteId: quoteRes.body.id };
  }

  async function backdateQuoteExpiry(quoteId: string, hoursAgo: number) {
    await prisma.quote.update({
      where: { id: quoteId },
      data: { expiresAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000) },
    });
  }

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();

      [customer, admin, finance] = await Promise.all([
        createCustomer('quote-expiry'),
        createStaff('quote-expiry-admin', Role.ADMIN),
        createStaff('quote-expiry-finance', Role.FINANCE),
      ]);
      [customerToken, adminToken, financeToken] = await Promise.all([
        login(app, customer.email),
        login(app, admin.email),
        login(app, finance.email),
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

  it('sets a validity window on a freshly issued quote', async () => {
    const { quoteId } = await createQuotedCase();
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    expect(quote.expiresAt).not.toBeNull();
    expect(quote.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects accepting an expired quote', async () => {
    const { quoteId } = await createQuotedCase();
    await backdateQuoteExpiry(quoteId, 1);

    const res = await request(app.getHttpServer())
      .post(`/api/quotes/${quoteId}/accept`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(400);
    expect(res.body.message).toMatch(/expired/i);
  });

  it('blocks Finance (non-Admin) from triggering the quote expiry sweep', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/quotes/run-expiry-sweep')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(403);
  });

  it('the sweep reopens an expired-unaccepted case for re-quoting, and leaves a fresh quote alone', async () => {
    const stale = await createQuotedCase();
    await backdateQuoteExpiry(stale.quoteId, 200); // ~8 days
    const fresh = await createQuotedCase(); // still within the default 7-day window

    const res = await request(app.getHttpServer())
      .post('/api/admin/quotes/run-expiry-sweep')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.expired).toBeGreaterThanOrEqual(1);

    const staleCase = await request(app.getHttpServer())
      .get(`/api/cases/${stale.caseId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(staleCase.body.status).toBe('UNDER_REVIEW');

    const freshCase = await request(app.getHttpServer())
      .get(`/api/cases/${fresh.caseId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(freshCase.body.status).toBe('QUOTED');

    // Staff can now issue a fresh quote on the reopened case.
    await request(app.getHttpServer())
      .post(`/api/cases/${stale.caseId}/quotes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [{ category: 'ASOJU_SERVICE_FEE', label: 'Revised fee', amount: 55000 }] })
      .expect(201);
  });

  it('re-running the sweep is a no-op for a case already reopened (idempotent)', async () => {
    const stale = await createQuotedCase();
    await backdateQuoteExpiry(stale.quoteId, 200);

    await request(app.getHttpServer())
      .post('/api/admin/quotes/run-expiry-sweep')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const afterFirst = await request(app.getHttpServer())
      .get(`/api/cases/${stale.caseId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(afterFirst.body.status).toBe('UNDER_REVIEW');

    await request(app.getHttpServer())
      .post('/api/admin/quotes/run-expiry-sweep')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const afterSecond = await request(app.getHttpServer())
      .get(`/api/cases/${stale.caseId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(afterSecond.body.status).toBe('UNDER_REVIEW');
  });
});
