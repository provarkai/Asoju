import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { PaymentStatus, Role } from '@prisma/client';
import { PaystackService } from '../src/payments/paystack.service';

/**
 * P0 Technical Build Spec Section 21 "Payment States" — PROCESSING existed
 * in the enum with nothing ever setting it. CommerceService.runPaymentVerificationSweep
 * polls Paystack's own transaction-verify endpoint directly for the case a
 * webhook is late/lost. No live Paystack account exists to test the real
 * HTTP call against (same boundary every other Paystack-integration spec
 * in this suite stops at — see refund.e2e-spec.ts's own comment), so the
 * one external-IO method (PaystackService.verifyTransaction) is stubbed
 * via the real app's own DI container rather than mocking fetch/HTTP —
 * everything else (Prisma writes, audit trail, case transitions, the
 * min-age/expiry-window candidate selection) runs for real.
 */
describe('Payment verification sweep', () => {
  let app: INestApplication;
  let paystack: PaystackService;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let customerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();
      paystack = app.get(PaystackService);
      [customer, admin] = await Promise.all([createCustomer('pay-verify'), createStaff('pay-verify-admin', Role.ADMIN)]);
      [customerToken, adminToken] = await Promise.all([login(app, customer.email), login(app, admin.email)]);
    });
  });

  beforeEach(async () => {
    app = await ensureHealthyApp(app);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /** Builds a case through to a PENDING Payment of the given amount (NGN),
   * backdated so it's old enough for the sweep to consider it (default
   * min-age window is 5 minutes; the built-in default expiry is 24h).
   * Same fast-forward-past-the-webhook pattern as payment-expiry.e2e-spec.ts. */
  async function createPendingPayment(amount: number, minutesOld: number): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Payment verification test case', location: 'Lagos', channel: 'web' })
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
    await prisma.payment.update({
      where: { id: payment.id },
      data: { createdAt: new Date(Date.now() - minutesOld * 60 * 1000) },
    });
    return payment.id;
  }

  it('is a safe no-op without PAYSTACK_SECRET_KEY — never invents a PROCESSING/PAID/FAILED status', async () => {
    const paymentId = await createPendingPayment(10_000, 10);
    const res = await request(app.getHttpServer())
      .post('/api/admin/payments/run-verification-sweep')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.processing).toBe(0);
    expect(res.body.paid).toBe(0);
    expect(res.body.failed).toBe(0);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe(PaymentStatus.PENDING);
  });

  // The sweep operates on every eligible Payment in the database, not just
  // the one a given test just created (same as payment-expiry.e2e-spec.ts's
  // own sweep tests) — so assertions here check this test's own payment by
  // id and whether *its* reference was among the calls, not the sweep's
  // aggregate counts or whether the mock was called at all.

  it('marks a payment PROCESSING when Paystack reports it still in flight', async () => {
    const paymentId = await createPendingPayment(10_000, 10);
    jest.spyOn(paystack, 'verifyTransaction').mockResolvedValue({ dryRun: false, status: 'pending', amountKobo: 1_000_000 });

    const res = await request(app.getHttpServer())
      .post('/api/admin/payments/run-verification-sweep')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.processing).toBeGreaterThanOrEqual(1);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe(PaymentStatus.PROCESSING);
  });

  it('marks a payment PAID and transitions the case when Paystack confirms success', async () => {
    const paymentId = await createPendingPayment(10_000, 10);
    jest.spyOn(paystack, 'verifyTransaction').mockResolvedValue({ dryRun: false, status: 'success', amountKobo: 1_000_000 });

    const res = await request(app.getHttpServer())
      .post('/api/admin/payments/run-verification-sweep')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.paid).toBeGreaterThanOrEqual(1);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { invoice: { include: { case: true } } } });
    expect(payment.status).toBe(PaymentStatus.PAID);
    expect(payment.invoice.case.status).toBe('SCHEDULED');
  });

  it('marks a payment FAILED when Paystack reports it abandoned, leaving the case retryable', async () => {
    const paymentId = await createPendingPayment(10_000, 10);
    jest.spyOn(paystack, 'verifyTransaction').mockResolvedValue({ dryRun: false, status: 'abandoned', gatewayResponse: 'Abandoned by user' });

    const res = await request(app.getHttpServer())
      .post('/api/admin/payments/run-verification-sweep')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.failed).toBeGreaterThanOrEqual(1);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { invoice: { include: { case: true } } } });
    expect(payment.status).toBe(PaymentStatus.FAILED);
    expect(payment.invoice.case.status).toBe('AWAITING_PAYMENT'); // untouched — customer can retry
  });

  it('never checks a payment younger than the min-age window — gives the webhook a fair chance first', async () => {
    const paymentId = await createPendingPayment(10_000, 1); // 1 minute old, default min-age is 5
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const spy = jest.spyOn(paystack, 'verifyTransaction').mockResolvedValue({ dryRun: false, status: 'success', amountKobo: 1_000_000 });

    await request(app.getHttpServer())
      .post('/api/admin/payments/run-verification-sweep')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(spy.mock.calls.some(([ref]) => ref === payment.providerReference)).toBe(false);

    const after = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(after.status).toBe(PaymentStatus.PENDING);
  });

  it('never checks a payment past the expiry window — that belongs to the expiry sweep', async () => {
    const paymentId = await createPendingPayment(10_000, 25 * 60); // 25 hours old, default expiry is 24h
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const spy = jest.spyOn(paystack, 'verifyTransaction').mockResolvedValue({ dryRun: false, status: 'success', amountKobo: 1_000_000 });

    await request(app.getHttpServer())
      .post('/api/admin/payments/run-verification-sweep')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(spy.mock.calls.some(([ref]) => ref === payment.providerReference)).toBe(false);

    const after = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(after.status).toBe(PaymentStatus.PENDING);
  });

  it('a payment stuck PROCESSING past the expiry window still gets recovered by the expiry sweep', async () => {
    const paymentId = await createPendingPayment(10_000, 10);
    jest.spyOn(paystack, 'verifyTransaction').mockResolvedValue({ dryRun: false, status: 'pending', amountKobo: 1_000_000 });
    await request(app.getHttpServer())
      .post('/api/admin/payments/run-verification-sweep')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    let payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe(PaymentStatus.PROCESSING);

    await prisma.payment.update({ where: { id: paymentId }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    await request(app.getHttpServer())
      .post('/api/admin/payments/run-expiry-sweep')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe(PaymentStatus.EXPIRED);
  });

  it('blocks Finance (non-Admin) from triggering the sweep', async () => {
    const finance = await createStaff('pay-verify-finance', Role.FINANCE);
    const financeToken = await login(app, finance.email);
    await request(app.getHttpServer())
      .post('/api/admin/payments/run-verification-sweep')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(403);
  });
});
