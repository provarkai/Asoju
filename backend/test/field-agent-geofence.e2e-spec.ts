import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@prisma/client';
import { createTestApp, ensureHealthyApp } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma } from './utils/fixtures';

/**
 * Ported from FieldForce's gps-geofence.ts validation primitives —
 * confirmed nothing equivalent existed here before: Assignment.checkIn
 * stored a free-form `location` blob unvalidated, no matter what it
 * contained. Property/Asset carry no coordinates on the vast majority of
 * records today (nothing geocodes an address), so this only becomes a real
 * geofence when a target is on file — otherwise the check-in is recorded
 * as UNVERIFIED and never blocked, preserving today's behaviour.
 *
 * Coordinates below: Ikeja, Lagos (6.6018, 3.3515) as the property target.
 * "Nearby" is ~45m away (within the 150m default radius); "far" is Victoria
 * Island, ~9km away.
 */
describe('Field agent GPS check-in — geofence validation', () => {
  let app: INestApplication;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let adminToken: string;

  const TARGET = { lat: 6.6018, lng: 3.3515 };
  const NEARBY = { lat: 6.60215, lng: 3.35195 };
  const FAR = { lat: 6.4281, lng: 3.4219 };

  beforeAll(async () => {
    app = await createTestApp();
    admin = await createStaff('geofence-admin', Role.ADMIN);
    adminToken = await login(app, admin.email);
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

  /** Builds a customer + agent + property (optionally with coordinates) +
   * a SCHEDULED/PAID/ASSIGNED case, and accepts the assignment — everything
   * short of the actual check-in call each test exercises differently. */
  async function setUpAcceptedAssignment(
    prefix: string,
    propertyCoords?: { lat: number; lng: number } | null,
  ) {
    const customer = await createCustomer(prefix);
    const agent = await createAgent(`${prefix}-agent`);
    const customerToken = await login(app, customer.email);
    const agentToken = await login(app, agent.email);

    let propertyId: string | undefined;
    if (propertyCoords !== null) {
      const property = await prisma.property.create({
        data: {
          customerId: customer.customer.id,
          address: '12 Adeniyi Jones Ave, Ikeja',
          city: 'Ikeja',
          state: 'Lagos',
          latitude: propertyCoords?.lat,
          longitude: propertyCoords?.lng,
        },
      });
      propertyId = property.id;
    }

    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: `${prefix} geofence test case`, location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD', propertyId })
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

    return { assignmentId: assignRes.body.id, agentToken };
  }

  it('records UNVERIFIED and never blocks check-in when the property has no coordinates on file', async () => {
    const { assignmentId, agentToken } = await setUpAcceptedAssignment('geofence-none', undefined);

    const checkInRes = await request(app.getHttpServer())
      .post(`/api/assignments/${assignmentId}/check-in`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ location: { lat: FAR.lat, lng: FAR.lng, accuracy: 15, capturedAt: new Date().toISOString() } })
      .expect(201);

    expect(checkInRes.body.geofenceResult).toBe('UNVERIFIED');
    expect(checkInRes.body.checkInAt).toBeTruthy();
  });

  it('PASSes and records distance when check-in is within the geofence radius of a real target', async () => {
    const { assignmentId, agentToken } = await setUpAcceptedAssignment('geofence-pass', TARGET);

    const checkInRes = await request(app.getHttpServer())
      .post(`/api/assignments/${assignmentId}/check-in`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ location: { lat: NEARBY.lat, lng: NEARBY.lng, accuracy: 12, capturedAt: new Date().toISOString() } })
      .expect(201);

    expect(checkInRes.body.geofenceResult).toBe('PASS');
    expect(checkInRes.body.geofenceDistanceMeters).toBeLessThan(150);
    expect(checkInRes.body.checkInAccuracy).toBe(12);
  });

  it('rejects check-in outright when it is well outside the geofence radius of a real target', async () => {
    const { assignmentId, agentToken } = await setUpAcceptedAssignment('geofence-fail', TARGET);

    await request(app.getHttpServer())
      .post(`/api/assignments/${assignmentId}/check-in`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ location: { lat: FAR.lat, lng: FAR.lng, accuracy: 12, capturedAt: new Date().toISOString() } })
      .expect(403);

    // Never partially applied — a rejected check-in leaves checkInAt unset.
    const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
    expect(assignment?.checkInAt).toBeNull();
    expect(assignment?.geofenceResult).toBeNull();
  });

  it('rejects check-in with implausible GPS accuracy, regardless of whether a target exists', async () => {
    const { assignmentId, agentToken } = await setUpAcceptedAssignment('geofence-accuracy', undefined);

    await request(app.getHttpServer())
      .post(`/api/assignments/${assignmentId}/check-in`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ location: { lat: TARGET.lat, lng: TARGET.lng, accuracy: 500, capturedAt: new Date().toISOString() } })
      .expect(422);
  });

  it('rejects check-in with a stale GPS fix, regardless of whether a target exists', async () => {
    const { assignmentId, agentToken } = await setUpAcceptedAssignment('geofence-stale', undefined);
    const staleTimestamp = new Date(Date.now() - 10 * 60_000).toISOString(); // 10 minutes old

    await request(app.getHttpServer())
      .post(`/api/assignments/${assignmentId}/check-in`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ location: { lat: TARGET.lat, lng: TARGET.lng, accuracy: 10, capturedAt: staleTimestamp } })
      .expect(422);
  });

  it('rejects structurally invalid coordinates outright, with a 400', async () => {
    const { assignmentId, agentToken } = await setUpAcceptedAssignment('geofence-invalid', undefined);

    await request(app.getHttpServer())
      .post(`/api/assignments/${assignmentId}/check-in`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ location: { lat: 200, lng: 3.35, accuracy: 10, capturedAt: new Date().toISOString() } })
      .expect(400);
  });

  it('still accepts a plain address-string check-in with no GPS at all, unchanged from before', async () => {
    const { assignmentId, agentToken } = await setUpAcceptedAssignment('geofence-address', undefined);

    const checkInRes = await request(app.getHttpServer())
      .post(`/api/assignments/${assignmentId}/check-in`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ location: { address: '12 Adeniyi Jones Ave, Ikeja, Lagos' } })
      .expect(201);

    expect(checkInRes.body.geofenceResult).toBe('UNVERIFIED');
    expect(checkInRes.body.checkInAt).toBeTruthy();
  });
});
