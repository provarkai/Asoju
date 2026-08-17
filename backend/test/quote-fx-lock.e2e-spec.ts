import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Platform Expansion PRD §4.3 "Exchange Rate Lock & Transparency" — real
 * app, real Postgres. Uses an ESSENTIAL-tier case (no subscription setup
 * needed, unlike membership.e2e-spec.ts) since the FX lock applies
 * regardless of membership tier — it's about the service-fee portion
 * having a USD-equivalent, not about discounts.
 */
describe('Quote exchange rate lock', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;

  async function createCaseUnderReview(): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'FX lock test case', location: 'Lagos', channel: 'web' })
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
      .send({ objective: 'Handle the request', tasks: ['Visit site'] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope/confirm`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    return caseId;
  }

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();

      [customer, admin] = await Promise.all([createCustomer('fx-lock'), createStaff('fx-lock-admin', Role.ADMIN)]);
      [customerToken, adminToken] = await Promise.all([login(app, customer.email), login(app, admin.email)]);

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

  it('locks the FX rate and a 48h expiry when the quote has a service fee, expressed in USD', async () => {
    const caseId = await createCaseUnderReview();
    const before = Date.now();

    const quoteRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/quotes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [{ category: 'ASOJU_SERVICE_FEE', label: 'ASOJU service fee', amount: 80000 }] })
      .expect(201);

    // Default USD_TO_NGN_RATE is 1600, same default every other test in
    // this suite that doesn't override it relies on.
    expect(Number(quoteRes.body.lockedFxRate)).toBe(1600);
    expect(quoteRes.body.sourceCurrency).toBe('USD');
    expect(quoteRes.body.fxLockExpiry).toBeTruthy();

    const expiryMs = new Date(quoteRes.body.fxLockExpiry).getTime();
    const hoursFromNow = (expiryMs - before) / (1000 * 60 * 60);
    expect(hoursFromNow).toBeGreaterThan(47.9);
    expect(hoursFromNow).toBeLessThan(48.1);
  });

  it('leaves the FX lock null for a quote with no ASOJU_SERVICE_FEE portion', async () => {
    const caseId = await createCaseUnderReview();

    const quoteRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/quotes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [{ category: 'EXTERNAL_COST', label: 'Registry fee', amount: 5000 }] })
      .expect(201);

    expect(quoteRes.body.lockedFxRate).toBeNull();
    expect(quoteRes.body.sourceCurrency).toBeNull();
    expect(quoteRes.body.fxLockExpiry).toBeNull();
  });
});
