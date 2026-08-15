import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { PaymentStatus, Role } from '@prisma/client';

/**
 * P0 Security, Privacy & Trust Architecture v1.0 §8 "Privileged Action
 * Matrix" — "Refund | Finance permission + threshold approval where
 * configured." Real app, real Postgres. Default threshold is ₦200,000
 * (REFUND_APPROVAL_THRESHOLD_NGN unset in the test env) — every amount
 * below deliberately stays under that so existing refund behaviour
 * (refund.e2e-spec.ts) is untouched; this suite exercises amounts above it.
 */
describe('Refund-amount threshold approval', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let finance: Awaited<ReturnType<typeof createStaff>>;
  let secondFinance: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;
  let financeToken: string;
  let secondFinanceToken: string;

  /** Builds a case through to a PAID Payment of the given amount (NGN),
   * returning the paymentId — mirrors refund.e2e-spec.ts's fast-forward. */
  async function createPaidPayment(amount: number): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Refund approval test case', location: 'Lagos', channel: 'web' })
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

    return payment.id;
  }

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();

      [customer, admin, finance, secondFinance] = await Promise.all([
        createCustomer('refundapproval'),
        createStaff('refundapproval-admin', Role.ADMIN),
        createStaff('refundapproval-finance', Role.FINANCE),
        createStaff('refundapproval-finance2', Role.FINANCE),
      ]);
      [customerToken, adminToken, financeToken, secondFinanceToken] = await Promise.all([
        login(app, customer.email),
        login(app, admin.email),
        login(app, finance.email),
        login(app, secondFinance.email),
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

  it('a refund at or below the threshold still executes immediately, unchanged', async () => {
    const paymentId = await createPaidPayment(150000);
    const res = await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ reason: 'Below threshold, immediate' })
      .expect(200);

    expect(res.body.refund).toBeTruthy();
    expect(res.body.refundRequest).toBeUndefined();
    expect(res.body.payment.status).toBe('REFUNDED');
  });

  it('a refund above the threshold creates a pending request instead of moving money', async () => {
    const paymentId = await createPaidPayment(300000);
    const res = await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ reason: 'Large refund, needs approval' })
      .expect(200);

    expect(res.body.refund).toBeUndefined();
    expect(res.body.refundRequest).toBeTruthy();
    expect(res.body.refundRequest.status).toBe('PENDING');

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe('PAID'); // untouched — no refund executed yet
    const refunds = await prisma.refund.findMany({ where: { paymentId } });
    expect(refunds).toHaveLength(0);
  });

  it('the requester cannot approve or reject their own refund request', async () => {
    const paymentId = await createPaidPayment(300000);
    const created = await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ reason: 'Self-approval attempt' })
      .expect(200);
    const refundRequestId = created.body.refundRequest.id;

    await request(app.getHttpServer())
      .post(`/api/admin/refund-requests/${refundRequestId}/approve`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/admin/refund-requests/${refundRequestId}/reject`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({})
      .expect(403);
  });

  it('a different Finance approver can approve, which then actually executes the refund', async () => {
    const paymentId = await createPaidPayment(400000);
    const created = await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ reason: 'Large refund' })
      .expect(200);
    const refundRequestId = created.body.refundRequest.id;

    const approved = await request(app.getHttpServer())
      .post(`/api/admin/refund-requests/${refundRequestId}/approve`)
      .set('Authorization', `Bearer ${secondFinanceToken}`)
      .send({ note: 'Confirmed with customer directly' })
      .expect(200);

    expect(approved.body.refund).toBeTruthy();
    expect(approved.body.payment.status).toBe('REFUNDED');

    const refundRequest = await prisma.refundRequest.findUniqueOrThrow({ where: { id: refundRequestId } });
    expect(refundRequest.status).toBe('APPROVED');
    expect(refundRequest.decidedById).toBeTruthy();

    // Already decided — can't approve or reject again.
    await request(app.getHttpServer())
      .post(`/api/admin/refund-requests/${refundRequestId}/approve`)
      .set('Authorization', `Bearer ${secondFinanceToken}`)
      .send({})
      .expect(400);
  });

  it('a different Finance approver can reject — no money moves', async () => {
    const paymentId = await createPaidPayment(500000);
    const created = await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ reason: 'Large refund, disputed' })
      .expect(200);
    const refundRequestId = created.body.refundRequest.id;

    const rejected = await request(app.getHttpServer())
      .post(`/api/admin/refund-requests/${refundRequestId}/reject`)
      .set('Authorization', `Bearer ${secondFinanceToken}`)
      .send({ note: 'Not eligible per policy' })
      .expect(200);
    expect(rejected.body.status).toBe('REJECTED');

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe('PAID');
    const refunds = await prisma.refund.findMany({ where: { paymentId } });
    expect(refunds).toHaveLength(0);
  });

  it('blocks a customer from the refund-request approval endpoints entirely', async () => {
    const paymentId = await createPaidPayment(300000);
    const created = await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ reason: 'Large refund' })
      .expect(200);
    const refundRequestId = created.body.refundRequest.id;

    await request(app.getHttpServer())
      .post(`/api/admin/refund-requests/${refundRequestId}/approve`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({})
      .expect(403);
  });

  it('lists pending refund requests for Finance to triage', async () => {
    const paymentId = await createPaidPayment(350000);
    await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ reason: 'For the queue' })
      .expect(200);

    const list = await request(app.getHttpServer())
      .get('/api/admin/refund-requests?status=PENDING')
      .set('Authorization', `Bearer ${secondFinanceToken}`)
      .expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.some((r: { paymentId: string }) => r.paymentId === paymentId)).toBe(true);
  });

  it('records payment.refund_requested and payment.refund_request_approved audit events', async () => {
    const paymentId = await createPaidPayment(300000);
    const created = await request(app.getHttpServer())
      .post(`/api/admin/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ reason: 'Audited request' })
      .expect(200);
    const refundRequestId = created.body.refundRequest.id;

    await request(app.getHttpServer())
      .post(`/api/admin/refund-requests/${refundRequestId}/approve`)
      .set('Authorization', `Bearer ${secondFinanceToken}`)
      .send({})
      .expect(200);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { invoice: true } });
    const events = await prisma.auditEvent.findMany({
      where: {
        caseId: payment.invoice.caseId,
        action: { in: ['payment.refund_requested', 'payment.refund_request_approved'] },
      },
    });
    expect(events.map((e) => e.action).sort()).toEqual(['payment.refund_request_approved', 'payment.refund_requested']);
  });
});
