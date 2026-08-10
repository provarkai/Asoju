import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { DEFAULT_PASSWORD, createCustomer, createStaff, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * P0 UX Spec "Admin Screen — Pricing Configuration" — membership plan
 * pricing/benefits are DB-backed (MembershipPlanConfig / PlanConfigService)
 * rather than the MEMBERSHIP_PLANS code constant this shipped with
 * initially, so Finance/Admin can adjust price, SC grant, discount%, and
 * the eligible-request allowance without a deploy. Real app, real
 * Postgres.
 *
 * All mutation here targets the PREMIUM plan only — PRIORITY's defaults
 * (99/50/10/2) are exercised and relied on throughout membership.e2e-spec.ts,
 * which can run concurrently with this file under Jest's default
 * per-file-worker parallelism, so this file never touches PRIORITY.
 * PREMIUM is restored to its shipped defaults in afterAll so the suite
 * stays safe to re-run against a non-empty database.
 */
describe('Membership plan pricing configuration', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let finance: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;
  let financeToken: string;

  const DEFAULT_PREMIUM = { priceUsd: 299, scGrantUsd: 150, discountPercent: 15, eligibleRequestsPerMonth: 5 };

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);
    return res.body.accessToken;
  }

  beforeAll(async () => {
    app = await createTestApp();

    [customer, admin, finance] = await Promise.all([
      createCustomer('plan-config'),
      createStaff('plan-config-admin', Role.ADMIN),
      createStaff('plan-config-finance', Role.FINANCE),
    ]);
    [customerToken, adminToken, financeToken] = await Promise.all([
      login(customer.email),
      login(admin.email),
      login(finance.email),
    ]);
  });

  afterAll(async () => {
    // Leave PREMIUM exactly as this suite found it, whether or not every
    // test above passed.
    await request(app.getHttpServer())
      .patch('/api/admin/membership-plans/PREMIUM')
      .set('Authorization', `Bearer ${financeToken}`)
      .send(DEFAULT_PREMIUM);

    await app.close();
    await prisma.$disconnect();
  });

  it('lists both plans, seeded with the documented defaults, for any logged-in user', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/membership-plans')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    const priority = res.body.find((p: { plan: string }) => p.plan === 'PRIORITY');
    const premium = res.body.find((p: { plan: string }) => p.plan === 'PREMIUM');
    expect(priority).toMatchObject({ priceUsd: 99, scGrantUsd: 50, discountPercent: 10, eligibleRequestsPerMonth: 2 });
    expect(premium).toMatchObject(DEFAULT_PREMIUM);
  });

  it('rejects an update from a customer — Finance/Admin only', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/membership-plans/PREMIUM')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ discountPercent: 20 })
      .expect(403);
  });

  it('rejects an unknown plan', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/membership-plans/NOT_A_PLAN')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ discountPercent: 20 })
      .expect(400);
  });

  it('rejects an update with no fields at all', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/membership-plans/PREMIUM')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({})
      .expect(400);
  });

  it('rejects an out-of-range discount', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/membership-plans/PREMIUM')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ discountPercent: 150 })
      .expect(400);
  });

  it("lets Admin update PREMIUM's discount/SC/allowance, live immediately for new reads", async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/admin/membership-plans/PREMIUM')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ discountPercent: 20, scGrantUsd: 200, eligibleRequestsPerMonth: 8 })
      .expect(200);
    expect(res.body).toMatchObject({ discountPercent: 20, scGrantUsd: 200, eligibleRequestsPerMonth: 8, priceUsd: 299 });

    const list = await request(app.getHttpServer())
      .get('/api/membership-plans')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    const premium = list.body.find((p: { plan: string }) => p.plan === 'PREMIUM');
    expect(premium).toMatchObject({ discountPercent: 20, scGrantUsd: 200, eligibleRequestsPerMonth: 8 });
  });

  it(
    "a price change after subscribing never alters what an already-active PREMIUM member locked in, " +
      'but a discount/SC/allowance change DOES apply to their very next quote',
    async () => {
      // Subscribe while PREMIUM is still priceUsd=299 (the config edit
      // above only touched discount/SC/allowance, not price).
      const subRes = await request(app.getHttpServer())
        .post('/api/me/subscription')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ plan: 'PREMIUM' })
        .expect(201);
      expect(Number(subRes.body.priceUsd)).toBe(299);
      expect(Number(subRes.body.amount)).toBe(299 * 1600);
      // The already-updated scGrantUsd (200, not the original 150) is what
      // a *new* subscription's first-grant reads live at subscribe time.
      const subscriptionId = subRes.body.id;

      // Now Finance drops the price to $199 and bumps discount to 25%.
      await request(app.getHttpServer())
        .patch('/api/admin/membership-plans/PREMIUM')
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ priceUsd: 199, discountPercent: 25 })
        .expect(200);

      // The existing subscription's locked price/amount are untouched.
      const mine = await request(app.getHttpServer())
        .get('/api/me/subscription')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      expect(mine.body.id).toBe(subscriptionId);
      expect(Number(mine.body.priceUsd)).toBe(299);
      expect(Number(mine.body.amount)).toBe(299 * 1600);
      // But the live-read plan benefits reflect the new config.
      expect(mine.body.planConfig.discountPercent).toBe(25);

      // A fresh CONCIERGE case for this same customer picks up the new
      // 25% discount live, not the 15%/20% it was ever subscribed under.
      const reqRes = await request(app.getHttpServer())
        .post('/api/service-requests')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ rawDescription: 'Premium plan-config live-read test', location: 'Lagos', channel: 'web' })
        .expect(201);
      const caseRes = await request(app.getHttpServer())
        .post(`/api/service-requests/${reqRes.body.id}/convert`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          serviceType: 'FAMILY_SUPPORT',
          description: 'Premium plan-config live-read test',
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

      const quoteRes = await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/quotes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100000 })
        .expect(201);
      // 25% of 100,000 = 25,000 — the live config at quote time, not
      // whatever the discount was when this customer originally subscribed.
      expect(Number(quoteRes.body.discountPercent)).toBe(25);
      expect(Number(quoteRes.body.discountAmount)).toBe(25000);
    },
  );
});
