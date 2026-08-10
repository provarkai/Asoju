import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { DEFAULT_PASSWORD, createCustomer, createStaff, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * P0 Technical Build Spec Section 15/16 "Quote Engine / Quote Line
 * Categories" — a quote's lines are categorized (ASOJU_SERVICE_FEE /
 * EXTERNAL_COST / THIRD_PARTY_PROFESSIONAL / TAX_STATUTORY), and
 * "Eligibility for member discount and SC is explicit" — only the
 * ASOJU_SERVICE_FEE lines are ever discount/SC-eligible; everything else
 * is a "separate customer-authorized cost" / "separate professional fee"
 * passed through untouched. Real app, real Postgres.
 *
 * All dollar math assumes the default USD_TO_NGN_RATE (1600) and default
 * Priority plan (10% discount, $50 SC) — unset in the test env, same as
 * membership.e2e-spec.ts.
 */
describe('Quote line categories', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);
    return res.body.accessToken;
  }

  /** Fast-forwards a fresh CONCIERGE-tier case to UNDER_REVIEW with a
   * confirmed scope — mirrors membership.e2e-spec.ts's helper. */
  async function createConciergeCaseUnderReview(): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Quote line category test', location: 'Lagos', channel: 'web' })
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

  beforeAll(async () => {
    app = await createTestApp();

    [customer, admin] = await Promise.all([
      createCustomer('quote-lines'),
      createStaff('quote-lines-admin', Role.ADMIN),
    ]);
    [customerToken, adminToken] = await Promise.all([login(customer.email), login(admin.email)]);

    await request(app.getHttpServer())
      .post('/api/me/subscription')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ plan: 'PRIORITY' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('rejects a quote with no lines', async () => {
    const caseId = await createConciergeCaseUnderReview();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/quotes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [] })
      .expect(400);
  });

  it('rejects an unknown line category', async () => {
    const caseId = await createConciergeCaseUnderReview();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/quotes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [{ category: 'NOT_A_CATEGORY', label: 'Bad line', amount: 1000 }] })
      .expect(400);
  });

  it(
    'applies the membership discount/SC to the ASOJU service fee only — external and third-party ' +
      'lines pass through untouched, both in the total and in the accepted amount',
    async () => {
      const caseId = await createConciergeCaseUnderReview();

      // 100,000 service fee, 30,000 external cost, 20,000 third-party fee.
      // 10% Priority discount on the 100,000 service fee = 10,000 ->
      // 90,000 after discount. $50 SC at 1600 = 80,000, less than what's
      // left, so all $50 applies: 90,000 - 80,000 = 10,000 service-fee
      // payable. Plus the untouched 30,000 + 20,000 = 60,000 total.
      const quoteRes = await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/quotes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          lines: [
            { category: 'ASOJU_SERVICE_FEE', label: 'Inspection fee', amount: 100000 },
            { category: 'EXTERNAL_COST', label: 'Notary fee', amount: 30000 },
            { category: 'THIRD_PARTY_PROFESSIONAL', label: 'Surveyor', amount: 20000 },
          ],
        })
        .expect(201);

      expect(Number(quoteRes.body.baseAmount)).toBe(100000);
      expect(Number(quoteRes.body.nonServiceFeeAmount)).toBe(50000);
      expect(Number(quoteRes.body.discountPercent)).toBe(10);
      expect(Number(quoteRes.body.discountAmount)).toBe(10000);
      expect(Number(quoteRes.body.scAppliedNgn)).toBe(80000);
      // 10,000 discounted service fee + 50,000 untouched external/professional.
      expect(Number(quoteRes.body.amount)).toBe(60000);
      expect(quoteRes.body.lines).toHaveLength(3);

      // Accepting locks in the same math — commitBenefit adds
      // nonServiceFeeAmount back on top too, not just createQuote's preview.
      const acceptRes = await request(app.getHttpServer())
        .post(`/api/quotes/${quoteRes.body.id}/accept`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(201);
      expect(Number(acceptRes.body.amount)).toBe(60000);

      const mine = await request(app.getHttpServer())
        .get('/api/me/subscription')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      expect(mine.body.scBalanceUsd).toBe(0);
    },
  );

  it('a quote with no ASOJU_SERVICE_FEE lines gets no benefit and never counts against the allowance', async () => {
    const caseId = await createConciergeCaseUnderReview();

    const before = await request(app.getHttpServer())
      .get('/api/me/subscription')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    const remainingBefore = before.body.eligibleRemainingThisPeriod;

    const quoteRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/quotes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [{ category: 'EXTERNAL_COST', label: 'Pure pass-through cost', amount: 15000 }] })
      .expect(201);

    expect(quoteRes.body.subscriptionId).toBeFalsy();
    expect(quoteRes.body.discountAmount).toBeFalsy();
    expect(Number(quoteRes.body.amount)).toBe(15000);

    const after = await request(app.getHttpServer())
      .get('/api/me/subscription')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(after.body.eligibleRemainingThisPeriod).toBe(remainingBefore);
  });
});
