import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * P0 Technical Build Spec Section 14 "Scope Versioning" / P0 Engineering
 * Backlog EPIC F — "material scope changes create a traceable new version
 * and cannot silently expand execution." Real app, real Postgres.
 */
describe('Scope versioning and the quote gate', () => {
  let app: INestApplication;

  let customerA: Awaited<ReturnType<typeof createCustomer>>;
  let customerB: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let agent: Awaited<ReturnType<typeof createAgent>>;

  let tokenA: string;
  let tokenB: string;
  let adminToken: string;
  let agentToken: string;
  let caseId: string;

  beforeAll(async () => {
    app = await createTestApp();

    [customerA, customerB, admin, agent] = await Promise.all([
      createCustomer('scope-a'),
      createCustomer('scope-b'),
      createStaff('scope-admin', Role.ADMIN),
      createAgent('scope-agent'),
    ]);
    [tokenA, tokenB, adminToken, agentToken] = await Promise.all([
      login(app, customerA.email),
      login(app, customerB.email),
      login(app, admin.email),
      login(app, agent.email),
    ]);

    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ rawDescription: 'Inspect my property before I quote', location: 'Lagos', channel: 'web' })
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
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('rejects a quote before any scope exists', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/quotes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [{ category: 'ASOJU_SERVICE_FEE', label: 'ASOJU service fee', amount: 50000 }] })
      .expect(400);
    expect(res.body.message).toMatch(/no scope/i);
  });

  it('blocks a field agent from proposing scope (staff-only)', async () => {
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ objective: 'Inspect the property', tasks: ['Walk the site'] })
      .expect(403);
  });

  it('lets staff propose version 1', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        objective: 'Inspect the property and report on condition',
        tasks: ['Walk the site', 'Photograph exterior', 'Check for structural damage'],
        deliverables: ['Written report with photos'],
        exclusions: ['No legal title verification'],
        evidenceRequirements: ['At least 10 photos'],
      })
      .expect(201);
    expect(res.body.version).toBe(1);
    expect(res.body.confirmedAt).toBeNull();
  });

  it('rejects a quote while the latest scope is unconfirmed', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/quotes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [{ category: 'ASOJU_SERVICE_FEE', label: 'ASOJU service fee', amount: 50000 }] })
      .expect(400);
    expect(res.body.message).toMatch(/not confirmed/i);
  });

  it("blocks a different customer from confirming another customer's scope", async () => {
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope/confirm`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(403);
  });

  it('lets the case owner confirm the scope, and confirming again is a harmless no-op', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope/confirm`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.confirmedAt).toBeTruthy();

    const again = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope/confirm`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(again.body.id).toBe(res.body.id);
  });

  it('now lets a quote be created, linked to the confirmed scope version', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/quotes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [{ category: 'ASOJU_SERVICE_FEE', label: 'ASOJU service fee', amount: 50000 }] })
      .expect(201);

    const latestScope = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/scope`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.scopeId).toBe(latestScope.body.id);
  });

  it('a scope revision starts a new, unconfirmed version — traceable, not overwritten', async () => {
    const revision = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ objective: 'Inspect the property, revised scope', tasks: ['Walk the site', 'Check the roof too'] })
      .expect(201);
    expect(revision.body.version).toBe(2);
    expect(revision.body.confirmedAt).toBeNull();

    const versions = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/scope/versions`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(versions.body).toHaveLength(2);
    expect(versions.body.map((v: { version: number }) => v.version).sort()).toEqual([1, 2]);

    // Version 1 was confirmed and already used for a quote — that's
    // untouched. Issuing a *new* quote now needs version 2 confirmed too.
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/quotes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [{ category: 'ASOJU_SERVICE_FEE', label: 'ASOJU service fee', amount: 60000 }] })
      .expect(400);
  });
});
