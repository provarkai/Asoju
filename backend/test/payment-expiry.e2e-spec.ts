import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { DEFAULT_PASSWORD, createCustomer, createStaff, prisma } from './utils/fixtures';
import { PaymentStatus, Role } from '@prisma/client';

/**
 * P0 Technical Build Spec Section 21 "Payment States" — EXPIRED: "Payment
 * window expired." A checkout that never resolves used to stay PENDING
 * forever with no signal. Real app, real Postgres.
 */
describe('Payment expiry sweep', () => {
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

  /** Builds a case through to a PENDING Payment, backdating its createdAt
   * so it's eligible for the expiry sweep (the built-in default window is
   * 24h; PAYMENT_EXPIRY_HOURS is unset in the test env, same as every
   * other configurable-window test in this suite relying on a documented
   * default). Returns the paymentId. */
  async function createPendingPayment(hoursOld: number): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Payment expiry test case', location: 'Lagos', channel: 'web' })
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
      data: { createdAt: new Date(Date.now() - hoursOld * 60 * 60 * 1000) },
    });

    return payment.id;
  }

  beforeAll(async () => {
    app = await createTestApp();

    [customer, admin, finance] = await Promise.all([
      createCustomer('pay-expiry'),
      createStaff('pay-expiry-admin', Role.ADMIN),
      createStaff('pay-expiry-finance', Role.FINANCE),
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

  it('blocks Finance (non-Admin) from triggering the sweep', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/payments/run-expiry-sweep')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(403);
  });

  it('expires a payment past the default 24h window, and leaves a fresh one alone', async () => {
    const stalePaymentId = await createPendingPayment(25);
    const freshPaymentId = await createPendingPayment(1);

    const res = await request(app.getHttpServer())
      .post('/api/admin/payments/run-expiry-sweep')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.expired).toBeGreaterThanOrEqual(1);

    const stale = await prisma.payment.findUniqueOrThrow({ where: { id: stalePaymentId } });
    expect(stale.status).toBe(PaymentStatus.EXPIRED);

    const fresh = await prisma.payment.findUniqueOrThrow({ where: { id: freshPaymentId } });
    expect(fresh.status).toBe(PaymentStatus.PENDING);
  });

  it('re-running the sweep is a no-op for an already-expired payment (idempotent)', async () => {
    const paymentId = await createPendingPayment(48);
    await request(app.getHttpServer())
      .post('/api/admin/payments/run-expiry-sweep')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const afterFirst = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(afterFirst.status).toBe(PaymentStatus.EXPIRED);

    await request(app.getHttpServer())
      .post('/api/admin/payments/run-expiry-sweep')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const afterSecond = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(afterSecond.status).toBe(PaymentStatus.EXPIRED);
  });
});
