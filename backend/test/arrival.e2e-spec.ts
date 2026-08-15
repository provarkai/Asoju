import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Phase 2 "ASOJU Arrival" (Master PRD v2.0 §6.4) — MVP slice: reuses the
 * shared case engine end to end (ARRIVAL_SUPPORT is a real ServiceType,
 * gets the standard checklist seeded like every other service) plus the
 * one genuinely new piece, the structured ArrivalProfile. Real app, real
 * Postgres.
 */
describe('ASOJU Arrival', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;

  async function createArrivalCase(): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Coming home for Christmas', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'ARRIVAL_SUPPORT', description: 'Welcome home coordination', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);
    return caseRes.body.id;
  }

  async function createNonArrivalCase(): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Inspect a property', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);
    return caseRes.body.id;
  }

  beforeAll(async () => {
    app = await createTestApp();

    [customer, admin] = await Promise.all([createCustomer('arrival'), createStaff('arrival-admin', Role.ADMIN)]);
    [customerToken, adminToken] = await Promise.all([login(app, customer.email), login(app, admin.email)]);
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

  it('seeds the standard 9-item Arrival checklist onto the case, same as any other service', async () => {
    const caseId = await createArrivalCase();
    const tasks = await prisma.caseTask.findMany({ where: { caseId }, orderBy: { sortOrder: 'asc' } });
    expect(tasks).toHaveLength(9);
    expect(tasks[0].label).toContain('Confirm arrival date, flight, and accommodation');
  });

  it('has no arrival profile until the customer sets one', async () => {
    const caseId = await createArrivalCase();
    const res = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/arrival-profile`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    // A null JSON body ("null") parses through supertest as {}, not null.
    expect(res.body).toEqual({});
  });

  it('the customer sets the arrival profile, then updates it (upsert)', async () => {
    const caseId = await createArrivalCase();

    const created = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/arrival-profile`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        arrivalDate: '2026-12-20',
        flightNumber: 'BA075',
        arrivalAirport: 'Lagos (LOS)',
        accommodationAddress: '12 Admiralty Way, Lekki',
        accommodationType: 'family_home',
        numberOfTravelers: 2,
        pickupRequired: true,
        groceriesRequired: true,
      })
      .expect(201);
    expect(created.body.flightNumber).toBe('BA075');
    expect(created.body.pickupRequired).toBe(true);

    const updated = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/arrival-profile`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ flightNumber: 'BA076', pickupRequired: false })
      .expect(201);
    expect(updated.body.id).toBe(created.body.id);
    expect(updated.body.flightNumber).toBe('BA076');
    expect(updated.body.pickupRequired).toBe(false);
    // Partial update: a field omitted from this call is left as it was
    // (progressive disclosure — filling in details across visits should
    // never silently wipe what's already on file), not cleared.
    expect(updated.body.accommodationAddress).toBe('12 Admiralty Way, Lekki');

    const fetched = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/arrival-profile`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(fetched.body.flightNumber).toBe('BA076');
  });

  it('rejects setting or reading an arrival profile on a non-Arrival case', async () => {
    const caseId = await createNonArrivalCase();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/arrival-profile`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ flightNumber: 'XX1' })
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/arrival-profile`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(400);
  });

  it('rejects an invalid accommodation type', async () => {
    const caseId = await createArrivalCase();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/arrival-profile`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ accommodationType: 'castle' })
      .expect(400);
  });

  it("a different customer cannot read or set another customer's arrival profile", async () => {
    const caseId = await createArrivalCase();
    const other = await createCustomer('arrival-other');
    const otherToken = await login(app, other.email);

    await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/arrival-profile`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/arrival-profile`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ flightNumber: 'XX1' })
      .expect(403);
  });

  it('records an arrival_profile.upserted audit event', async () => {
    const caseId = await createArrivalCase();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/arrival-profile`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ flightNumber: 'BA075' })
      .expect(201);

    const events = await prisma.auditEvent.findMany({ where: { caseId, action: 'arrival_profile.upserted' } });
    expect(events).toHaveLength(1);
  });
});
