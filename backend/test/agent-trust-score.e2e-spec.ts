import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@prisma/client';
import { createTestApp } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma } from './utils/fixtures';

/**
 * Ported from FieldForce's trust-score.ts — a richer, complementary signal
 * to Agent.tier/qcPassRate (#28). Every component is adapted to what
 * ASOJU's data actually tracks (see agent-trust-score.service.ts's own
 * header comment for the specifics); this suite proves the adaptation
 * computes real, hand-verifiable numbers, not just that it runs.
 */
describe('Agent Trust Score', () => {
  let app: INestApplication;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await createStaff('trust-score-admin', Role.ADMIN);
    adminToken = await login(app, admin.email);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('is all zeros, tier NEW, for a fresh agent with no history', async () => {
    const agent = await createAgent('trust-score-fresh');
    const agentToken = await login(app, agent.email);

    const res = await request(app.getHttpServer())
      .get(`/api/agents/${agent.agent.id}/trust-score`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      completionScore: 0,
      gpsComplianceScore: 0,
      evidenceScore: 0,
      ratingScore: 0,
      responseScore: 0,
      compositeScore: 0,
      trustTier: 'NEW',
      totalAssignments: 0,
      completedAssignments: 0,
    });
  });

  it('computes every component correctly for a single well-formed assignment, and blends the low-sample-size ones toward neutral', async () => {
    const customer = await createCustomer('trust-score-full');
    const agent = await createAgent('trust-score-full-agent');
    const customerToken = await login(app, customer.email);
    const agentToken = await login(app, agent.email);

    // A property WITH real coordinates, so the check-in below can PASS a
    // real geofence (not just UNVERIFIED — GPS compliance is only judged
    // on attempts with a real target, see #35/#37's design).
    const target = { lat: 6.6018, lng: 3.3515 };
    const property = await prisma.property.create({
      data: { customerId: customer.customer.id, address: '12 Adeniyi Jones Ave', city: 'Ikeja', state: 'Lagos', latitude: target.lat, longitude: target.lng },
    });

    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Trust score full test case', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD', propertyId: property.id })
      .expect(201);
    const caseId = caseRes.body.id;

    await prisma.serviceCase.update({ where: { id: caseId }, data: { status: 'SCHEDULED', paymentStatus: 'PAID' } });

    const assignRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/assignments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'FIELD_AGENT', agentId: agent.agent.id })
      .expect(201);

    // Accept immediately — a near-zero response latency should score 100
    // on the response-time component (<=5 minutes bucket).
    await request(app.getHttpServer())
      .post(`/api/assignments/${assignRes.body.id}/accept`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(201);

    // Check in inside the geofence — real PASS, not UNVERIFIED.
    const nearby = { lat: 6.60215, lng: 3.35195 }; // ~45m from target
    await request(app.getHttpServer())
      .post(`/api/assignments/${assignRes.body.id}/check-in`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ location: { lat: nearby.lat, lng: nearby.lng, accuracy: 12, capturedAt: new Date().toISOString() } })
      .expect(201);

    // Submit real evidence via the real upload-url -> evidence flow. No
    // SLA target is set on this case, so any evidence counts as on-time.
    const uploadUrlRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/evidence/upload-url`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ fileName: 'inspection.jpg', contentType: 'image/jpeg' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/evidence`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ type: 'PHOTO', storageKey: uploadUrlRes.body.storageKey })
      .expect(201);

    // Rating: set directly (a real Rating->performanceScore recompute flow
    // is exercised elsewhere — see ratings tests) so this suite stays
    // focused on the trust-score composite itself.
    await prisma.agent.update({ where: { id: agent.agent.id }, data: { performanceScore: 4 } });

    // Fast-forward the case to COMPLETED for the completion component —
    // matches this repo's established convention (see job-card.e2e-spec.ts)
    // for reaching a state real flows would take many more steps to hit.
    await prisma.serviceCase.update({ where: { id: caseId }, data: { status: 'COMPLETED' } });

    const res = await request(app.getHttpServer())
      .get(`/api/agents/${agent.agent.id}/trust-score`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Hand-computed against agent-trust-score.service.ts's exact formulas,
    // with totalAssignments=1 in every case (below every MIN_FOR_* volume
    // threshold), so each component blends its raw 100% rate toward the
    // neutral midpoint rather than reporting the raw rate outright:
    //   volumeBlend(100, 1, N) = round(100*(1/N) + 50*(1-1/N))
    expect(res.body.totalAssignments).toBe(1);
    expect(res.body.completedAssignments).toBe(1);
    expect(res.body.completionScore).toBe(55); // volumeBlend(100, 1, 10) = round(10 + 45)
    expect(res.body.gpsComplianceScore).toBe(60); // volumeBlend(100, 1, 5) = round(20 + 40)
    expect(res.body.evidenceScore).toBe(60); // volumeBlend(100, 1, 5) = round(20 + 40)
    expect(res.body.ratingScore).toBe(80); // 4/5 * 100
    expect(res.body.responseScore).toBe(100); // accepted within seconds
    // composite = 55*.3 + 60*.2 + 60*.2 + 80*.2 + 100*.1 = 66.5 -> 67
    expect(res.body.compositeScore).toBe(67);
    expect(res.body.trustTier).toBe('GOLD'); // >= 65
    expect(res.body.trustBadge).toBe('🥇');
  });

  it('records a rejected-outside-geofence check-in as a GPS compliance strike, not a silent no-op', async () => {
    const customer = await createCustomer('trust-score-gps-fail');
    const agent = await createAgent('trust-score-gps-fail-agent');
    const customerToken = await login(app, customer.email);
    const agentToken = await login(app, agent.email);

    const target = { lat: 6.6018, lng: 3.3515 };
    const property = await prisma.property.create({
      data: { customerId: customer.customer.id, address: 'Far Test Rd', city: 'Lagos', state: 'Lagos', latitude: target.lat, longitude: target.lng },
    });

    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'GPS fail trust score case', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD', propertyId: property.id })
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

    // Far away — rejected (403), never reaches Assignment.geofenceResult.
    const far = { lat: 6.4281, lng: 3.4219 };
    await request(app.getHttpServer())
      .post(`/api/assignments/${assignRes.body.id}/check-in`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ location: { lat: far.lat, lng: far.lng, accuracy: 12, capturedAt: new Date().toISOString() } })
      .expect(403);

    const res = await request(app.getHttpServer())
      .get(`/api/agents/${agent.agent.id}/trust-score`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // 0 PASS, 1 rejection judged -> volumeBlend(0, 1, 5) = round(0 + 40) = 40
    expect(res.body.gpsComplianceScore).toBe(40);
  });

  it('blocks one field agent from viewing another’s trust score, but allows staff', async () => {
    const owner = await createAgent('trust-score-owner');
    const outsider = await createAgent('trust-score-outsider');
    const outsiderToken = await login(app, outsider.email);

    await request(app.getHttpServer())
      .get(`/api/agents/${owner.agent.id}/trust-score`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get(`/api/agents/${owner.agent.id}/trust-score`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('blocks a field agent from the org-wide leaderboard and the admin sweep trigger', async () => {
    const agent = await createAgent('trust-score-leaderboard-blocked');
    const agentToken = await login(app, agent.email);

    await request(app.getHttpServer())
      .get('/api/agents/trust-leaderboard')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/admin/agent-trust-score/run')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(403);
  });

  it('the admin sweep recomputes scores for every active agent and the leaderboard reflects it', async () => {
    const agent = await createAgent('trust-score-sweep');
    await prisma.agent.update({ where: { id: agent.agent.id }, data: { performanceScore: 5 } });

    await request(app.getHttpServer())
      .post('/api/admin/agent-trust-score/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const leaderboardRes = await request(app.getHttpServer())
      .get('/api/agents/trust-leaderboard')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const entry = leaderboardRes.body.find((e: { agentId: string }) => e.agentId === agent.agent.id);
    expect(entry).toBeDefined();
    // ratingScore = 5/5*100 = 100; every other component is 0 (no
    // assignments at all) -> composite = 100*.2 = 20 -> tier BRONZE.
    expect(entry.compositeScore).toBe(20);
    expect(entry.trustTier).toBe('BRONZE');
  });
});
