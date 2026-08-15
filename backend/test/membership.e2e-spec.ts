import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Independent readiness review follow-up (ASOJU P0 Technical Build Spec
 * v1.0 Section 17 "Membership Engine" / Section 18 "SC Ledger") — real
 * app, real Postgres, no mocks. Confirms the commercial rules the spec
 * calls out explicitly: 10%/15% discount, the SC ledger never going
 * negative, the monthly eligible-request cap, and a manual adjustment
 * always requiring a reason.
 *
 * All dollar math below assumes the default USD_TO_NGN_RATE (1600) — the
 * test env leaves it unset on purpose, same as everywhere else in this
 * suite that relies on a documented default rather than hard-coding an
 * env override.
 */
describe('Membership / SC ledger', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let finance: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;
  let financeToken: string;
  let subscriptionId: string;

  /** Fast-forwards a fresh CONCIERGE-tier case to UNDER_REVIEW with a
   * confirmed scope (now a prerequisite for quoting — see
   * scope.e2e-spec.ts for the scope-gate tests themselves; this helper
   * exists so the membership/SC tests don't have to re-derive that setup) —
   * the quote/membership machinery is what's under test here, not the
   * request->case conversion chain (covered in authorization.e2e-spec.ts). */
  async function createConciergeCaseUnderReview(): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Concierge case for membership testing', location: 'Lagos', channel: 'web' })
      .expect(201);

    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        serviceType: 'FAMILY_SUPPORT',
        description: 'Concierge case',
        location: 'Lagos',
        priority: 'STANDARD',
        tier: 'CONCIERGE',
      })
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
      .send({ objective: 'Handle the request', tasks: ['Visit site', 'Compile report'] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope/confirm`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    return caseId;
  }

  async function myScBalance(): Promise<number> {
    const res = await request(app.getHttpServer())
      .get('/api/me/subscription')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    return res.body.scBalanceUsd;
  }

  beforeAll(async () => {
    app = await createTestApp();

    [customer, admin, finance] = await Promise.all([
      createCustomer('membership'),
      createStaff('membership-admin', Role.ADMIN),
      createStaff('membership-finance', Role.FINANCE),
    ]);
    [customerToken, adminToken, financeToken] = await Promise.all([
      login(app, customer.email),
      login(app, admin.email),
      login(app, finance.email),
    ]);
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

  it('subscribes to Priority and grants $50 SC immediately, before any renewal', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/me/subscription')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ plan: 'PRIORITY' })
      .expect(201);
    expect(res.body.plan).toBe('PRIORITY');
    expect(Number(res.body.priceUsd)).toBe(99);
    subscriptionId = res.body.id;

    const mine = await request(app.getHttpServer())
      .get('/api/me/subscription')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(mine.body.scBalanceUsd).toBe(50);
    expect(mine.body.eligibleRemainingThisPeriod).toBe(2);

    const ledger = await request(app.getHttpServer())
      .get('/api/me/subscription/sc-ledger')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(ledger.body).toHaveLength(1);
    expect(ledger.body[0].type).toBe('GRANT');
    expect(Number(ledger.body[0].amountUsd)).toBe(50);
  });

  it('rejects subscribing twice while already active', async () => {
    await request(app.getHttpServer())
      .post('/api/me/subscription')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ plan: 'PRIORITY' })
      .expect(400);
  });

  it('applies the 10% Priority discount and SC server-side on quote #1, then debits only on acceptance', async () => {
    const caseId = await createConciergeCaseUnderReview();

    const quoteRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/quotes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [{ category: 'ASOJU_SERVICE_FEE', label: 'ASOJU service fee', amount: 100000 }] })
      .expect(201);

    // 10% of 100,000 = 10,000 discount -> 90,000 after discount. $50 SC
    // at the default 1600 rate = 80,000 NGN, which is less than what's
    // left after the discount, so all $50 gets applied: 90,000 - 80,000
    // = 10,000 payable.
    expect(Number(quoteRes.body.baseAmount)).toBe(100000);
    expect(Number(quoteRes.body.discountPercent)).toBe(10);
    expect(Number(quoteRes.body.discountAmount)).toBe(10000);
    expect(Number(quoteRes.body.scAppliedNgn)).toBe(80000);
    expect(Number(quoteRes.body.amount)).toBe(10000);
    expect(quoteRes.body.subscriptionId).toBe(subscriptionId);

    // Not yet debited — still just a preview.
    expect(await myScBalance()).toBe(50);

    await request(app.getHttpServer())
      .post(`/api/quotes/${quoteRes.body.id}/accept`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);

    // Now debited to exactly zero.
    expect(await myScBalance()).toBe(0);
  });

  it('never lets the SC ledger go negative — quote #2 (still eligible) gets no SC left to apply', async () => {
    const caseId = await createConciergeCaseUnderReview();
    const quoteRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/quotes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [{ category: 'ASOJU_SERVICE_FEE', label: 'ASOJU service fee', amount: 500000 }] })
      .expect(201);

    // Still the 2nd eligible request this period (Priority allows 2), so
    // the 10% discount still applies — but SC balance is already 0.
    expect(Number(quoteRes.body.discountPercent)).toBe(10);
    expect(Number(quoteRes.body.scAppliedNgn)).toBe(0);
    expect(Number(quoteRes.body.amount)).toBe(450000);

    await request(app.getHttpServer())
      .post(`/api/quotes/${quoteRes.body.id}/accept`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);

    expect(await myScBalance()).toBeGreaterThanOrEqual(0);
    expect(await myScBalance()).toBe(0);
  });

  it('enforces the monthly eligible-request allowance — the 3rd Priority request this period gets no benefit at all', async () => {
    const caseId = await createConciergeCaseUnderReview();
    const quoteRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/quotes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [{ category: 'ASOJU_SERVICE_FEE', label: 'ASOJU service fee', amount: 50000 }] })
      .expect(201);

    expect(quoteRes.body.subscriptionId).toBeFalsy();
    expect(quoteRes.body.discountAmount).toBeFalsy();
    expect(Number(quoteRes.body.amount)).toBe(50000);

    const mine = await request(app.getHttpServer())
      .get('/api/me/subscription')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(mine.body.eligibleRemainingThisPeriod).toBe(0);
  });

  describe('Finance SC adjustment', () => {
    it('rejects an adjustment with no reason', async () => {
      await request(app.getHttpServer())
        .post(`/api/admin/subscriptions/${subscriptionId}/sc-adjustment`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ amountUsd: 10, reason: '' })
        .expect(400);
    });

    it('blocks a customer from adjusting their own SC balance', async () => {
      await request(app.getHttpServer())
        .post(`/api/admin/subscriptions/${subscriptionId}/sc-adjustment`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ amountUsd: 1000, reason: 'self-serve top-up attempt' })
        .expect(403);
    });

    it('lets Finance apply a signed, reasoned adjustment and it shows up on the ledger', async () => {
      await request(app.getHttpServer())
        .post(`/api/admin/subscriptions/${subscriptionId}/sc-adjustment`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ amountUsd: 25, reason: 'Goodwill credit — delayed field visit' })
        .expect(200);

      const ledger = await request(app.getHttpServer())
        .get(`/api/admin/subscriptions/${subscriptionId}/sc-ledger`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      const adjustment = ledger.body.find((e: { type: string }) => e.type === 'ADJUSTMENT');
      expect(adjustment).toBeTruthy();
      expect(Number(adjustment.amountUsd)).toBe(25);
      expect(adjustment.reason).toContain('Goodwill');

      expect(await myScBalance()).toBe(25);
    });
  });
});
