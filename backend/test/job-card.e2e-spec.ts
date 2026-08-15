import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * P0 Technical Build Spec Section 22 "Job Card Engine" — "Generated only
 * from approved scope... Contains exact tasks and exclusions... Contains
 * evidence requirements." The field agent's case detail now carries the
 * case's scope history so the app can show a job card built from exactly
 * what the customer confirmed — never an unconfirmed revision, per Section
 * 14's "cannot silently expand execution". Real app, real Postgres.
 */
describe('Job card — confirmed scope surfaced to the field agent', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let agent: Awaited<ReturnType<typeof createAgent>>;

  let customerToken: string;
  let adminToken: string;
  let agentToken: string;

  beforeAll(async () => {
    app = await createTestApp();

    [customer, admin, agent] = await Promise.all([
      createCustomer('job-card'),
      createStaff('job-card-admin', Role.ADMIN),
      createAgent('job-card-agent'),
    ]);
    [customerToken, adminToken, agentToken] = await Promise.all([
      login(app, customer.email),
      login(app, admin.email),
      login(app, agent.email),
    ]);
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

  it('shows the field agent the confirmed scope as the job card, not an unconfirmed revision', async () => {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Job card visibility test case', location: 'Lagos', channel: 'web' })
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

    // Version 1, confirmed.
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        objective: 'Inspect the property and report on condition',
        tasks: ['Walk the site', 'Photograph exterior'],
        exclusions: ['No legal title verification'],
        evidenceRequirements: ['At least 10 photos'],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope/confirm`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    // A second, unconfirmed revision — the field agent must never see this
    // one as the binding job card.
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ objective: 'Inspect the property, expanded scope', tasks: ['Walk the site', 'Also survey the boundary'] })
      .expect(201);

    // Fast-forward past quote/payment (covered elsewhere) straight to an
    // assigned, in-progress case — this suite is about job-card visibility,
    // not the payment chain.
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

    const detail = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(detail.body.scopes).toHaveLength(2);
    const confirmed = detail.body.scopes.find((s: { confirmedAt: string | null }) => s.confirmedAt);
    expect(confirmed.version).toBe(1);
    expect(confirmed.tasks).toEqual(['Walk the site', 'Photograph exterior']);
    expect(confirmed.exclusions).toEqual(['No legal title verification']);
    expect(confirmed.evidenceRequirements).toEqual(['At least 10 photos']);

    const unconfirmed = detail.body.scopes.find((s: { version: number }) => s.version === 2);
    expect(unconfirmed.confirmedAt).toBeNull();
  });
});
