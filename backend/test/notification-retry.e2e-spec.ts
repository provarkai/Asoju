import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * P0 API Specification & Integration Contracts v1.0 §30 "Notification
 * APIs" — `POST /notifications/{id}/retry`. Real app, real Postgres.
 * ZAVU_API_KEY/RESEND_API_KEY are both unset in the test env, so a real
 * channel send is never actually attempted here — same dry-run-safe
 * boundary as every other integration in this repo. That boundary is
 * exactly what this suite proves: the endpoints work correctly and never
 * fake success, whether or not a provider happens to be configured.
 */
describe('Notification channel fan-out and retry', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let finance: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;
  let financeToken: string;

  beforeAll(async () => {
    app = await createTestApp();

    [customer, admin, finance] = await Promise.all([
      createCustomer('notifyretry'),
      createStaff('notifyretry-admin', Role.ADMIN),
      createStaff('notifyretry-finance', Role.FINANCE),
    ]);
    [customerToken, adminToken, financeToken] = await Promise.all([
      login(app, customer.email),
      login(app, admin.email),
      login(app, finance.email),
    ]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('notify() leaves a plain in-app notification untouched when no channel provider is configured', async () => {
    // Triggering a real notify() call site (ScopeService.createOrRevise)
    // rather than seeding the row directly — this is the actual
    // regression-safety guarantee: every existing notify() call site in
    // the app must behave exactly as before this feature existed.
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Notification fan-out test case', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseRes.body.id}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ toStatus: 'SUBMITTED' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseRes.body.id}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ toStatus: 'UNDER_REVIEW' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseRes.body.id}/scope`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ objective: 'Inspect', tasks: ['Visit site'] })
      .expect(201);

    const inbox = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    const latest = inbox.body[0];
    expect(latest.title).toMatch(/scope/i);
    expect(latest.channel).toBeNull();
    expect(latest.deliveryStatus).toBe('SENT');
  });

  it('retrying a FAILED notification with no provider configured leaves it FAILED — never fakes success', async () => {
    const notification = await prisma.notification.create({
      data: {
        userId: customer.user.id,
        title: 'Your report is ready',
        body: 'Test body',
        channel: 'whatsapp',
        deliveryStatus: 'FAILED',
        failureReason: 'whatsapp delivery failed',
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/notifications/admin/${notification.id}/retry`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.deliveryStatus).toBe('FAILED');
    expect(res.body.channel).toBe('whatsapp');
  });

  it('rejects retrying a notification that is not in a failed state', async () => {
    const notification = await prisma.notification.create({
      data: { userId: customer.user.id, title: 'Fine as-is', body: 'Test body' },
    });
    await request(app.getHttpServer())
      .post(`/api/notifications/admin/${notification.id}/retry`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('404s retrying a notification that does not exist', async () => {
    await request(app.getHttpServer())
      .post('/api/notifications/admin/00000000-0000-0000-0000-000000000000/retry')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('blocks non-admin roles from retry and the failed-delivery queue entirely', async () => {
    const notification = await prisma.notification.create({
      data: { userId: customer.user.id, title: 'X', body: 'Y', channel: 'email', deliveryStatus: 'FAILED' },
    });

    await request(app.getHttpServer())
      .post(`/api/notifications/admin/${notification.id}/retry`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/notifications/admin/failed')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/notifications/admin/failed')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
  });

  it('lists failed notifications for admin triage', async () => {
    const notification = await prisma.notification.create({
      data: { userId: customer.user.id, title: 'Failed one', body: 'body', channel: 'email', deliveryStatus: 'FAILED', failureReason: 'email delivery failed' },
    });

    const res = await request(app.getHttpServer())
      .get('/api/notifications/admin/failed')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.some((n: { id: string }) => n.id === notification.id)).toBe(true);
  });

  it('records a notification.retried audit event', async () => {
    const notification = await prisma.notification.create({
      data: { userId: customer.user.id, title: 'Audited retry', body: 'body', channel: 'whatsapp', deliveryStatus: 'FAILED' },
    });

    await request(app.getHttpServer())
      .post(`/api/notifications/admin/${notification.id}/retry`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const events = await prisma.auditEvent.findMany({ where: { action: 'notification.retried' } });
    expect(
      events.some((e) => (e.metadata as { notificationId?: string } | null)?.notificationId === notification.id),
    ).toBe(true);
  });
});
