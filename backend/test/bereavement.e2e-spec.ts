import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Tier 2 vertical (strategic-suggestions pass, "top pick — cheapest
 * vertical-add, tightest urgency profile") — bereavement & funeral
 * logistics rides the same case engine as every other service, but is the
 * one place a real gap in the SLA engine mattered: SLA_HOURS_* previously
 * keyed off CasePriority only, so an unqualified triage silently landed a
 * bereavement case on the 72h STANDARD clock. Real app, real Postgres.
 */
describe('Bereavement & funeral logistics vertical', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let customerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();

      [customer, admin] = await Promise.all([createCustomer('bereave'), createStaff('bereave-admin', Role.ADMIN)]);
      [customerToken, adminToken] = await Promise.all([login(app, customer.email), login(app, admin.email)]);

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

  async function createRequest(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'My father passed away, need help with arrangements', location: 'Lagos', channel: 'web' })
      .expect(201);
    return res.body.id;
  }

  async function convert(requestId: string, priority?: string): Promise<{ id: string; priority: string }> {
    const res = await request(app.getHttpServer())
      .post(`/api/service-requests/${requestId}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        serviceType: 'BEREAVEMENT_SUPPORT',
        description: 'Coordinate mortuary, venue, and permits',
        location: 'Lagos',
        ...(priority ? { priority } : {}),
      })
      .expect(201);
    return res.body;
  }

  it('defaults an unqualified bereavement case to URGENT priority (not the STANDARD default)', async () => {
    const requestId = await createRequest();
    const created = await convert(requestId);
    expect(created.priority).toBe('URGENT');

    const caseRow = await prisma.serviceCase.findUniqueOrThrow({ where: { id: created.id } });
    const windowHours = (caseRow.slaTargetAt!.getTime() - caseRow.createdAt.getTime()) / (60 * 60 * 1000);
    expect(windowHours).toBeCloseTo(24, 0);
  });

  it('an explicit staff-chosen priority overrides the bereavement default', async () => {
    const requestId = await createRequest();
    const created = await convert(requestId, 'STANDARD');
    expect(created.priority).toBe('STANDARD');

    const caseRow = await prisma.serviceCase.findUniqueOrThrow({ where: { id: created.id } });
    const windowHours = (caseRow.slaTargetAt!.getTime() - caseRow.createdAt.getTime()) / (60 * 60 * 1000);
    expect(windowHours).toBeCloseTo(72, 0);
  });

  it('does not change the default priority of an unrelated service (regression check)', async () => {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Check on my property', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect the property', location: 'Lagos' })
      .expect(201);
    expect(caseRes.body.priority).toBe('STANDARD');
  });

  it('seeds the vendor-coordination checklist, not a generic inspection checklist', async () => {
    const requestId = await createRequest();
    const created = await convert(requestId);

    const tasks = await prisma.caseTask.findMany({ where: { caseId: created.id }, orderBy: { sortOrder: 'asc' } });
    const labels = tasks.map((t) => t.label);
    expect(labels).toContain('Confirm mortuary — location, hold status, and release requirements');
    expect(labels).toContain('Confirm burial/venue booking and date');
    expect(labels).toContain('Confirm permits and documentation required (death certificate, burial permit)');
    // Never the property-inspection checklist's language.
    expect(labels).not.toContain('Photograph the property');
  });

  it('the customer sees the case with a human-readable service label', async () => {
    const requestId = await createRequest();
    const created = await convert(requestId);

    const detail = await request(app.getHttpServer())
      .get(`/api/cases/${created.id}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(detail.body.serviceType).toBe('BEREAVEMENT_SUPPORT');
    expect(detail.body.status).toBe('DRAFT');
  });
});
