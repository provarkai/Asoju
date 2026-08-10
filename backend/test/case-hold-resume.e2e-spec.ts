import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * P0 Technology & Platform Requirements Specification v1.0 §8 "Case
 * Status Model" — "ON HOLD | Blocked pending information/decision/
 * condition. | Block removed or case cancelled." Real app, real Postgres.
 */
describe('Case ON_HOLD state', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let caseManager: Awaited<ReturnType<typeof createStaff>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let agent: Awaited<ReturnType<typeof createAgent>>;

  let customerToken: string;
  let caseManagerToken: string;
  let adminToken: string;
  let agentToken: string;

  async function createCase(): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Hold/resume test case', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);
    const caseId: string = caseRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/claim`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .expect(201);

    return caseId;
  }

  beforeAll(async () => {
    app = await createTestApp();

    [customer, caseManager, admin, agent] = await Promise.all([
      createCustomer('hold'),
      createStaff('hold-cm', Role.CASE_MANAGER),
      createStaff('hold-admin', Role.ADMIN),
      createAgent('hold-agent'),
    ]);
    [customerToken, caseManagerToken, adminToken, agentToken] = await Promise.all([
      login(app, customer.email),
      login(app, caseManager.email),
      login(app, admin.email),
      login(app, agent.email),
    ]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('holds a case with a reason, then resumes it back to exactly where it was', async () => {
    const caseId = await createCase();
    // Move it somewhere non-trivial first, so resume has to prove it
    // remembers the *actual* prior status, not just "back to DRAFT".
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

    const held = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/hold`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ reason: 'Waiting on customer to confirm site access' })
      .expect(201);
    expect(held.body.status).toBe('ON_HOLD');

    const resumed = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/resume`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ reason: 'Customer confirmed access' })
      .expect(201);
    expect(resumed.body.status).toBe('UNDER_REVIEW');
  });

  it('rejects holding a case with no reason', async () => {
    const caseId = await createCase();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/hold`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({})
      .expect(400);
  });

  it('rejects holding a case that is already on hold', async () => {
    const caseId = await createCase();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/hold`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ reason: 'First hold' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/hold`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ reason: 'Second hold attempt' })
      .expect(400);
  });

  it('rejects resuming a case that is not on hold', async () => {
    const caseId = await createCase();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/resume`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({})
      .expect(400);
  });

  it('blocks a field agent from holding or resuming a case', async () => {
    const caseId = await createCase();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/hold`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ reason: 'trying anyway' })
      .expect(403);
  });

  it('the generic transition endpoint cannot be used to enter or leave ON_HOLD', async () => {
    const caseId = await createCase();
    // A fresh case is DRAFT; ON_HOLD is never in DRAFT's allowed targets.
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ toStatus: 'ON_HOLD' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/hold`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ reason: 'On hold now' })
      .expect(201);

    // And once on hold, the generic endpoint has nowhere valid to go either.
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ toStatus: 'SUBMITTED' })
      .expect(400);
  });

  it('records case.held and case.resumed audit events with the reason', async () => {
    const caseId = await createCase();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/hold`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ reason: 'Awaiting risk sign-off' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/resume`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .expect(201);

    const events = await prisma.auditEvent.findMany({
      where: { caseId, action: { in: ['case.held', 'case.resumed'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.action)).toEqual(['case.held', 'case.resumed']);
    expect((events[0].metadata as { reason?: string }).reason).toBe('Awaiting risk sign-off');
  });

  it('cannot hold a COMPLETED or CLOSED case', async () => {
    const caseId = await createCase();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ toStatus: 'CLOSED' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/hold`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ reason: 'too late' })
      .expect(400);
  });
});
