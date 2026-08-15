import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@prisma/client';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma } from './utils/fixtures';

/**
 * Ported from FieldForce's live-tracking.ts — continuous location pings
 * while an assignment is active, distinct from the single point-in-time,
 * geofence-gated Assignment.checkIn. Confirmed nothing equivalent existed
 * before: no LocationPing model, no path/distance calc, no "active
 * agents" ops feed anywhere in this backend.
 *
 * Note: Assignment.completedAt has no setter anywhere in this app today
 * (confirmed — grepped every prisma.assignment.update call site); the
 * "no more pings after completion" test below sets it directly via
 * Prisma, matching this suite's own established convention (see
 * job-card.e2e-spec.ts's status fast-forwards) for exercising a state
 * this app's own flows can't reach yet.
 */
describe('Live GPS tracking — continuous location pings on an active assignment', () => {
  let app: INestApplication;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let adminToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();
      admin = await createStaff('tracking-admin', Role.ADMIN);
      adminToken = await login(app, admin.email);

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

  async function setUpCheckedInAssignment(prefix: string) {
    const customer = await createCustomer(prefix);
    const agent = await createAgent(`${prefix}-agent`);
    const customerToken = await login(app, customer.email);
    const agentToken = await login(app, agent.email);

    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: `${prefix} tracking test case`, location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);
    const caseId = caseRes.body.id;

    await prisma.serviceCase.update({ where: { id: caseId }, data: { status: 'SCHEDULED', paymentStatus: 'PAID' } });
    const assignRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/assignments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'FIELD_AGENT', agentId: agent.agent.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/assignments/${assignRes.body.id}/accept`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/assignments/${assignRes.body.id}/check-in`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ location: { address: 'On site' } })
      .expect(201);

    return { assignmentId: assignRes.body.id, agentToken, caseId };
  }

  it('rejects a location ping before check-in', async () => {
    const customer = await createCustomer('tracking-precheckin');
    const agent = await createAgent('tracking-precheckin-agent');
    const customerToken = await login(app, customer.email);
    const agentToken = await login(app, agent.email);

    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Pre-checkin ping test', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);
    await prisma.serviceCase.update({ where: { id: caseRes.body.id }, data: { status: 'SCHEDULED', paymentStatus: 'PAID' } });
    const assignRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseRes.body.id}/assignments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'FIELD_AGENT', agentId: agent.agent.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/assignments/${assignRes.body.id}/accept`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/assignments/${assignRes.body.id}/location`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ lat: 6.6, lng: 3.35, accuracy: 10 })
      .expect(400);
  });

  it('accepts pings after check-in and computes a filtered path distance', async () => {
    const { assignmentId, agentToken } = await setUpCheckedInAssignment('tracking-path');

    // Three real pings walking roughly north-east, plus one deliberately
    // low-accuracy reading in between that the distance calc must skip.
    const points = [
      { lat: 6.6018, lng: 3.3515, accuracy: 10 },
      { lat: 6.6022, lng: 3.352, accuracy: 8 },
      { lat: 6.6031, lng: 3.353, accuracy: 400 }, // noisy — excluded from distance
      { lat: 6.6040, lng: 3.354, accuracy: 9 },
    ];

    for (const [i, point] of points.entries()) {
      await request(app.getHttpServer())
        .post(`/api/assignments/${assignmentId}/location`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ ...point, capturedAt: new Date(Date.now() + i * 1000).toISOString() })
        .expect(201);
    }

    const trackRes = await request(app.getHttpServer())
      .get(`/api/assignments/${assignmentId}/track`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(trackRes.body.pointCount).toBe(4);
    // Distance only sums reliable legs (point0->1 and point2->3's *neighbours*
    // are excluded because point2 itself is unreliable) — so only the
    // point0->point1 leg counts, a few hundred metres.
    expect(trackRes.body.totalDistanceMeters).toBeGreaterThan(0);
    expect(trackRes.body.totalDistanceMeters).toBeLessThan(2000);
    expect(trackRes.body.pings).toHaveLength(4);
  });

  it('rejects structurally invalid coordinates on a ping', async () => {
    const { assignmentId, agentToken } = await setUpCheckedInAssignment('tracking-invalid');

    await request(app.getHttpServer())
      .post(`/api/assignments/${assignmentId}/location`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ lat: 200, lng: 3.35 })
      .expect(400);
  });

  it('rejects further pings once the assignment is completed', async () => {
    const { assignmentId, agentToken } = await setUpCheckedInAssignment('tracking-completed');

    await prisma.assignment.update({ where: { id: assignmentId }, data: { completedAt: new Date() } });

    await request(app.getHttpServer())
      .post(`/api/assignments/${assignmentId}/location`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ lat: 6.6, lng: 3.35, accuracy: 10 })
      .expect(400);
  });

  it('blocks a different field agent from viewing another agent’s track', async () => {
    const { assignmentId, agentToken: ownerToken } = await setUpCheckedInAssignment('tracking-owner');
    const otherAgent = await createAgent('tracking-outsider');
    const otherToken = await login(app, otherAgent.email);

    await request(app.getHttpServer())
      .post(`/api/assignments/${assignmentId}/location`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ lat: 6.6, lng: 3.35, accuracy: 10 })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/assignments/${assignmentId}/track`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);

    // ADMIN can always see it.
    await request(app.getHttpServer())
      .get(`/api/assignments/${assignmentId}/track`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('surfaces a checked-in, ping-reporting agent on the ops active-locations feed', async () => {
    const { assignmentId, agentToken, caseId } = await setUpCheckedInAssignment('tracking-active-feed');

    await request(app.getHttpServer())
      .post(`/api/assignments/${assignmentId}/location`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ lat: 6.6018, lng: 3.3515, accuracy: 10 })
      .expect(201);

    const feedRes = await request(app.getHttpServer())
      .get('/api/agents/active-locations')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const entry = feedRes.body.find((e: { assignmentId: string }) => e.assignmentId === assignmentId);
    expect(entry).toBeDefined();
    expect(entry.caseId).toBe(caseId);
    expect(entry.source).toBe('LIVE_PING');
    expect(entry.latitude).toBeCloseTo(6.6018, 3);
  });

  it('blocks a field agent from the org-wide active-locations feed', async () => {
    const { agentToken } = await setUpCheckedInAssignment('tracking-feed-blocked');

    await request(app.getHttpServer())
      .get('/api/agents/active-locations')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(403);
  });
});
