import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { DEFAULT_PASSWORD, createCustomer, createStaff, prisma } from './utils/fixtures';
import { PaymentStatus, Role } from '@prisma/client';

/**
 * P0 Technical Build Spec Section 20/21 "Payment Architecture / Payment
 * States" — "Support failed, pending, reversed and refunded states." A
 * `Refund` model has existed in the schema with zero call sites; this is
 * the actual Finance-initiated full/partial refund flow. Real app, real
 * Postgres.
 *
 * Driving a Payment to PAID normally requires a verified Paystack webhook
 * (PaystackWebhookGuard — real HMAC signature verification, fails closed
 * without PAYSTACK_SECRET_KEY, same as every other e2e spec's payment
 * setup). That chain is exercised elsewhere; this suite flips the payment
 * row to PAID directly via Prisma — the same fast-forward-past-what's-
 * covered-elsewhere pattern authorization.e2e-spec.ts and qc-outcomes.
 * e2e-spec.ts already use for the assignment/payment chain — so it can
 * focus on the refund logic itself.
 */
describe('Payment refunds', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let finance: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;
  let financeToken: string;

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);
    return res.body.accessToken;
  }

  /** Builds a case through to a PAID Payment of the given amount (NGN),
   * returning the paymentId. */
  async function createPaidPayment(amount: number): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Refund test case', location: 'Lagos', channel: 'web' })
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
      .send({ amount })
      .expect(201);
    const acceptRes = await request(app.getHttpServer())
      .post(`/api/quotes/${quoteRes.body.id}/accept`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);
    const invoiceId = acceptRes.body.id;

    const payRes = await request(app.getHttpServer())
      .post(`/api/invoices/${invoiceId}/pay`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);
    expect(payRes.body.dryRun).toBe(true); // no PAYSTACK_SECRET_KEY in the test env

    const payment = await prisma.payment.findFirstOrThrow({ where: { invoiceId } });
    await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });
    await prisma.serviceCase.update({ where: { id: caseId }, data: { paymentStatus: PaymentStatus.PAID } });

    return payment.id;
  }

  beforeAll(async () => {
    app = await createTestApp();

    [customer, admin, finance] = await Promise.all([
      createCustomer('refund'),
      createStaff('refund-admin', Role.ADMIN),
      createStaff('refund-finance', Role.FINANCE),
    ]);
    [customerToken, adminToken, financeToken] = await Promise.all([
      login(customer.email),
      login(admin.email),
      login(finance.email),
    ]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('blocks a customer from issuing a refund', async () => {
    const paymentId = await createPaidPayment(50000);
    await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'self-serve attempt' })
      .expect(403);
  });

  it('rejects a refund with no reason', async () => {
    const paymentId = await createPaidPayment(50000);
    await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({})
      .expect(400);
  });

  it('lets Finance issue a full refund, marking the payment REFUNDED', async () => {
    const paymentId = await createPaidPayment(50000);
    const res = await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ reason: 'Case cancelled at customer request' })
      .expect(200);

    expect(Number(res.body.refund.amount)).toBe(50000);
    expect(res.body.refund.reason).toContain('cancelled');
    expect(res.body.payment.status).toBe('REFUNDED');

    // Nothing left to refund now.
    await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ reason: 'trying again' })
      .expect(400);
  });

  it('supports a partial refund, then a second partial refund that completes it — never over-refunding', async () => {
    const paymentId = await createPaidPayment(100000);

    const first = await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ amount: 40000, reason: 'Partial goodwill refund' })
      .expect(200);
    expect(first.body.payment.status).toBe('PARTIALLY_REFUNDED');

    // Can't over-refund the remaining 60,000.
    await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ amount: 70000, reason: 'too much' })
      .expect(400);

    // Completing it with the exact remainder marks it fully REFUNDED.
    const second = await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ amount: 60000, reason: 'Remainder refunded' })
      .expect(200);
    expect(second.body.payment.status).toBe('REFUNDED');

    const refunds = await prisma.refund.findMany({ where: { paymentId } });
    expect(refunds).toHaveLength(2);
    expect(refunds.reduce((sum, r) => sum + Number(r.amount), 0)).toBe(100000);
  });
});
