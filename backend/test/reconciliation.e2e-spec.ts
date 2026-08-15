import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { PaymentStatus, Role } from '@prisma/client';

/**
 * Database Schema & ERD Design v1.0 Section 17 "Finance Schema" —
 * `reconciliations | id, payment_id, reconciled_by, reconciled_at, status,
 * notes`. Closes the loop the webhook amount-mismatch path opens: a
 * RECONCILIATION_REQUIRED payment used to have no admin action at all.
 * Real app, real Postgres.
 *
 * Driving a Payment to RECONCILIATION_REQUIRED normally requires a
 * verified Paystack webhook whose amount doesn't match the invoice
 * (PaystackWebhookGuard — real HMAC signature verification). That
 * detection path is separate from what's under test here — this suite
 * flips the payment row to RECONCILIATION_REQUIRED directly via Prisma,
 * the same fast-forward-past-what's-covered-elsewhere pattern
 * refund.e2e-spec.ts already uses, so it can focus on the resolution flow.
 */
describe('Payment reconciliation resolution', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let finance: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;
  let financeToken: string;

  /** Builds a case through to a RECONCILIATION_REQUIRED Payment of the
   * given invoiced amount (NGN), returning { paymentId, caseId }. */
  async function createReconciliationRequiredPayment(amount: number): Promise<{ paymentId: string; caseId: string }> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Reconciliation test case', location: 'Lagos', channel: 'web' })
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

    const payRes = await request(app.getHttpServer())
      .post(`/api/invoices/${invoiceId}/pay`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);
    expect(payRes.body.dryRun).toBe(true); // no PAYSTACK_SECRET_KEY in the test env

    const payment = await prisma.payment.findFirstOrThrow({ where: { invoiceId } });
    await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.RECONCILIATION_REQUIRED } });
    await prisma.serviceCase.update({ where: { id: caseId }, data: { paymentStatus: PaymentStatus.RECONCILIATION_REQUIRED } });

    return { paymentId: payment.id, caseId };
  }

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();

      [customer, admin, finance] = await Promise.all([
        createCustomer('reconcile'),
        createStaff('reconcile-admin', Role.ADMIN),
        createStaff('reconcile-finance', Role.FINANCE),
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

  it('blocks a customer from resolving a reconciliation', async () => {
    const { paymentId } = await createReconciliationRequiredPayment(50000);
    await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/reconcile`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ status: 'MATCHED', notes: 'self-serve attempt' })
      .expect(403);
  });

  it('rejects a resolution with no notes', async () => {
    const { paymentId } = await createReconciliationRequiredPayment(50000);
    await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/reconcile`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ status: 'MATCHED' })
      .expect(400);
  });

  it('rejects resolving a payment that is not awaiting reconciliation', async () => {
    const { paymentId } = await createReconciliationRequiredPayment(50000);
    await prisma.payment.update({ where: { id: paymentId }, data: { status: PaymentStatus.PAID } });
    await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/reconcile`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ status: 'MATCHED', notes: 'already fine' })
      .expect(400);
  });

  it('lets Finance mark a reconciliation MATCHED, moving the payment and case to PAID', async () => {
    const { paymentId, caseId } = await createReconciliationRequiredPayment(50000);
    const res = await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/reconcile`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ status: 'MATCHED', notes: 'Confirmed with Paystack dashboard — bank fee explains the delta' })
      .expect(200);

    expect(res.body.reconciliation.status).toBe('MATCHED');
    expect(res.body.payment.status).toBe('PAID');

    const persisted = await prisma.reconciliation.findUnique({ where: { id: res.body.reconciliation.id } });
    expect(persisted?.reconciledBy).toBeTruthy();

    const caseRow = await prisma.serviceCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(caseRow.paymentStatus).toBe('PAID');

    // Resolved — no longer awaiting reconciliation, can't resolve again.
    await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/reconcile`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ status: 'MATCHED', notes: 'trying again' })
      .expect(400);
  });

  it('MATCHED with a resolvedAmount corrects the payment amount on record', async () => {
    const { paymentId } = await createReconciliationRequiredPayment(50000);
    const res = await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/reconcile`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ status: 'MATCHED', notes: 'Paystack actually received 48,500', resolvedAmount: 48500 })
      .expect(200);

    expect(Number(res.body.payment.amount)).toBe(48500);
  });

  it('lets Finance mark a reconciliation REJECTED, moving the payment and case to FAILED so the customer can retry', async () => {
    const { paymentId, caseId } = await createReconciliationRequiredPayment(75000);
    const res = await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/reconcile`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ status: 'REJECTED', notes: 'No matching settlement found in the Paystack dashboard' })
      .expect(200);

    expect(res.body.reconciliation.status).toBe('REJECTED');
    expect(res.body.payment.status).toBe('FAILED');

    const caseRow = await prisma.serviceCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(caseRow.paymentStatus).toBe('FAILED');

    // A fresh payment attempt on the same invoice is still allowed.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await request(app.getHttpServer())
      .post(`/api/invoices/${payment.invoiceId}/pay`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);
  });
});
