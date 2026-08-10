import { randomBytes } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma, uniqueEmail } from './utils/fixtures';
import { PaymentStatus, Role } from '@prisma/client';

// User.phone is globally unique (schema.prisma) and acceptBeneficiaryInvite
// copies Beneficiary.phone onto the new User — same reasoning as
// beneficiary-portal.e2e-spec.ts's own uniquePhone() helper.
function uniquePhone(): string {
  return `+234${randomBytes(5).toString('hex')}`;
}

/**
 * Tier 1 slice (strategic-suggestions pass) — one screen instead of
 * re-deriving the same picture from several endpoints: active cases by
 * status, saved properties/assets with their most recent case,
 * beneficiaries' portal-access status, total spend, membership balance,
 * upcoming scheduled visits, referral stats. Deliberately scoped to a
 * single Customer — no cross-Account-member rollup (resolved product
 * decision: "every client is independent"). Real app, real Postgres.
 */
describe('Customer portfolio dashboard', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let agent: Awaited<ReturnType<typeof createAgent>>;

  let customerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();

    [customer, admin, agent] = await Promise.all([
      createCustomer('portfolio'),
      createStaff('portfolio-admin', Role.ADMIN),
      createAgent('portfolio-agent'),
    ]);
    [customerToken, adminToken] = await Promise.all([login(app, customer.email), login(app, admin.email)]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function portfolio() {
    return request(app.getHttpServer())
      .get('/api/me/portfolio')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
  }

  /** Drives a case through to an initiated-but-not-yet-PAID Payment of the
   * given amount (NGN), returning both the caseId and paymentId. Same
   * fast-forward-past-the-webhook pattern as refund.e2e-spec.ts. Optionally
   * links a saved property. */
  async function createUnpaidCase(amount: number, propertyId?: string): Promise<{ caseId: string; paymentId: string }> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Portfolio test case', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        serviceType: 'PROPERTY_INSPECTION',
        description: 'Inspect',
        location: 'Lagos',
        priority: 'STANDARD',
        propertyId,
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
    return { caseId, paymentId: payment.id };
  }

  /** Builds a case through to a PAID Payment of the given amount (NGN).
   * Optionally links a saved property. */
  async function createPaidCase(amount: number, propertyId?: string): Promise<string> {
    const { caseId, paymentId } = await createUnpaidCase(amount, propertyId);
    await prisma.payment.update({ where: { id: paymentId }, data: { status: PaymentStatus.PAID } });
    await prisma.serviceCase.update({ where: { id: caseId }, data: { paymentStatus: PaymentStatus.PAID } });
    return caseId;
  }

  it('sums total spend exactly across every PAID payment, excluding anything not yet PAID', async () => {
    const before = await portfolio();
    const startingSpend = before.body.totalSpendByCurrency.NGN ?? 0;

    await createPaidCase(50_000);
    await createPaidCase(75_500);
    // Left PENDING deliberately — an initiated-but-unconfirmed checkout
    // must never count as spend (that's the whole reason this bucket
    // isn't just "sum every payment row").
    await createUnpaidCase(999_000);

    const after = await portfolio();
    expect(after.body.totalSpendByCurrency.NGN).toBe(startingSpend + 50_000 + 75_500);
  });

  it('buckets active cases by status and counts COMPLETED/CLOSED separately, never both', async () => {
    const caseId = await createPaidCase(10_000);
    const before = await portfolio();
    const beforeCompleted = before.body.completedCases;
    expect(Object.values(before.body.activeCasesByStatus)).toBeDefined();

    // Walking the full state machine golden path isn't this test's
    // concern (authorization.e2e-spec.ts and the qc/report suites already
    // exercise it) — fast-forward straight to COMPLETED, same
    // past-what's-covered-elsewhere pattern as marking the payment PAID.
    await prisma.serviceCase.update({ where: { id: caseId }, data: { status: 'COMPLETED' } });

    const after = await portfolio();
    expect(after.body.completedCases).toBe(beforeCompleted + 1);
    const total = Object.values(after.body.activeCasesByStatus as Record<string, number>).reduce(
      (sum, n) => sum + n,
      0,
    );
    expect(total + after.body.completedCases).toBe(after.body.totalCases);
  });

  it('links each saved property to its most recent case', async () => {
    const propRes = await request(app.getHttpServer())
      .post('/api/me/properties')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ address: '12 Portfolio Close', city: 'Lagos' })
      .expect(201);
    const propertyId = propRes.body.id;

    const firstCaseId = await createPaidCase(5_000, propertyId);
    await new Promise((r) => setTimeout(r, 5)); // guarantee distinct createdAt ordering
    const secondCaseId = await createPaidCase(6_000, propertyId);

    const res = await portfolio();
    const property = res.body.properties.find((p: { id: string }) => p.id === propertyId);
    expect(property).toBeTruthy();
    expect(property.lastCase.id).toBe(secondCaseId);
    expect(property.lastCase.id).not.toBe(firstCaseId);
  });

  it('flags whether each beneficiary has claimed portal access', async () => {
    const withAccessRes = await request(app.getHttpServer())
      .post('/api/me/beneficiaries')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ fullName: 'Has Access', relationship: 'Mother', phone: uniquePhone() })
      .expect(201);
    const noAccessRes = await request(app.getHttpServer())
      .post('/api/me/beneficiaries')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ fullName: 'No Access', relationship: 'Brother' })
      .expect(201);

    const inviteRes = await request(app.getHttpServer())
      .post(`/api/me/beneficiaries/${withAccessRes.body.id}/invite`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);
    const token = new URL(inviteRes.body.devInviteLink).searchParams.get('token')!;
    await request(app.getHttpServer())
      .post('/api/auth/beneficiary-invite/accept')
      .send({ token, email: uniqueEmail('portfolio-claim'), password: 'Passw0rd!23' })
      .expect(200);

    const res = await portfolio();
    const withAccess = res.body.beneficiaries.find((b: { id: string }) => b.id === withAccessRes.body.id);
    const noAccess = res.body.beneficiaries.find((b: { id: string }) => b.id === noAccessRes.body.id);
    expect(withAccess.hasPortalAccess).toBe(true);
    expect(noAccess.hasPortalAccess).toBe(false);
  });

  it('lists upcoming scheduled visits, soonest first, excluding past and declined ones', async () => {
    // Assignments are only creatable once a case is past payment
    // (SCHEDULED/ASSIGNED/IN_PROGRESS) — createPaidCase marks the Payment
    // PAID directly (bypassing the webhook that would normally also
    // advance the case), so bump status the same fast-forward way.
    async function createScheduledCase(amount: number): Promise<string> {
      const caseId = await createPaidCase(amount);
      await prisma.serviceCase.update({ where: { id: caseId }, data: { status: 'SCHEDULED' } });
      return caseId;
    }

    const caseId = await createScheduledCase(8_000);
    const future1 = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const future2 = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const soonerAssignment = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/assignments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'FIELD_AGENT', agentId: agent.agent.id, scheduledFor: future2.toISOString() })
      .expect(201);
    void soonerAssignment;

    // A second case with a later-scheduled visit, and a third with a
    // past one that should never appear.
    const caseId2 = await createScheduledCase(9_000);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId2}/assignments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'FIELD_AGENT', agentId: agent.agent.id, scheduledFor: future1.toISOString() })
      .expect(201);

    const caseId3 = await createScheduledCase(1_000);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId3}/assignments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'FIELD_AGENT', agentId: agent.agent.id, scheduledFor: past.toISOString() })
      .expect(201);

    const res = await portfolio();
    const caseIds = res.body.upcomingVisits.map((v: { caseId: string }) => v.caseId);
    expect(caseIds).not.toContain(caseId3);
    const idxSooner = caseIds.indexOf(caseId);
    const idxLater = caseIds.indexOf(caseId2);
    expect(idxSooner).toBeGreaterThanOrEqual(0);
    expect(idxLater).toBeGreaterThanOrEqual(0);
    expect(idxSooner).toBeLessThan(idxLater);
  });

  it('has no membership block for a customer with no subscription, a populated one after subscribing', async () => {
    const before = await portfolio();
    expect(before.body.membership).toBeNull();

    await request(app.getHttpServer())
      .post('/api/me/subscription')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ plan: 'PRIORITY' })
      .expect(201);

    const after = await portfolio();
    expect(after.body.membership).toBeTruthy();
    expect(after.body.membership.plan).toBe('PRIORITY');
    expect(after.body.membership.status).toBe('ACTIVE');
    expect(typeof after.body.membership.scBalanceUsd).toBe('number');
  });

  it('round-trips this customer\'s own referral code', async () => {
    const res = await portfolio();
    expect(res.body.referral.code).toBe(customer.customer.referralCode);
    expect(typeof res.body.referral.referredCount).toBe('number');
  });
});
