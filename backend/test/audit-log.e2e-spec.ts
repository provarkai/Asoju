import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Admin Console & Platform Admin Architecture v1.0 Section 26 "Audit Log"
 * (P0 MVP screen A20) / API Specification v1.0 Section 28 — every
 * material action across this app is already recorded via
 * AuditService.record(); this is the first endpoint that makes any of it
 * actually searchable rather than only readable per-case. Real app, real
 * Postgres.
 */
describe('Admin audit log', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let caseManager: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;
  let caseManagerToken: string;
  let caseId: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();

      [customer, admin, caseManager] = await Promise.all([
        createCustomer('audit-log'),
        createStaff('audit-log-admin', Role.ADMIN),
        createStaff('audit-log-cm', Role.CASE_MANAGER),
      ]);
      [customerToken, adminToken, caseManagerToken] = await Promise.all([
        login(app, customer.email),
        login(app, admin.email),
        login(app, caseManager.email),
      ]);

      // Generates a handful of real, distinct audit events tied to a known
      // case: scope.created then scope.confirmed.
      const reqRes = await request(app.getHttpServer())
        .post('/api/service-requests')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ rawDescription: 'Audit log test case', location: 'Lagos', channel: 'web' })
        .expect(201);
      const caseRes = await request(app.getHttpServer())
        .post(`/api/service-requests/${reqRes.body.id}/convert`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
        .expect(201);
      caseId = caseRes.body.id;

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

  it('blocks a customer from searching the audit log', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/audit-events')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
  });

  it('blocks staff below Admin/SuperAdmin', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/audit-events')
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .expect(403);
  });

  it('filters by caseId to exactly the events for that case', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/audit-events')
      .query({ caseId })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.events.every((e: { caseId: string }) => e.caseId === caseId)).toBe(true);
    const actions = res.body.events.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['scope.created', 'scope.confirmed']));
    // Actor is resolved, not just an ID.
    expect(res.body.events[0].actor).toBeTruthy();
  });

  it('filters by action substring, case-insensitively', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/audit-events')
      .query({ caseId, action: 'SCOPE.CONFIRM' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.events[0].action).toBe('scope.confirmed');
  });

  it('filters by actorId', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/audit-events')
      .query({ caseId, actorId: customer.user.id })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.events.every((e: { actorId: string }) => e.actorId === customer.user.id)).toBe(true);
  });

  it('excludes events outside a from/to date range', async () => {
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app.getHttpServer())
      .get('/api/admin/audit-events')
      .query({ caseId, from: farFuture })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.total).toBe(0);
  });

  it('paginates with take/skip', async () => {
    const page1 = await request(app.getHttpServer())
      .get('/api/admin/audit-events')
      .query({ caseId, take: 1, skip: 0 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(page1.body.events).toHaveLength(1);

    const page2 = await request(app.getHttpServer())
      .get('/api/admin/audit-events')
      .query({ caseId, take: 1, skip: 1 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(page2.body.events).toHaveLength(1);
    expect(page2.body.events[0].id).not.toBe(page1.body.events[0].id);
  });

  it('retrieves a single event by id, and 404s for an unknown one', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/admin/audit-events')
      .query({ caseId, action: 'scope.confirmed' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const eventId = list.body.events[0].id;

    const single = await request(app.getHttpServer())
      .get(`/api/admin/audit-events/${eventId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(single.body.id).toBe(eventId);
    expect(single.body.case.caseNumber).toBeTruthy();

    await request(app.getHttpServer())
      .get('/api/admin/audit-events/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });
});
