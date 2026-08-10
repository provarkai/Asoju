import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * P0 Technology & Platform Requirements Specification v1.0 §9 "Case
 * Control Requirements" — "Every active case must answer: who owns it,
 * who is executing it, what happens next, when is it due." Real app, real
 * Postgres.
 */
describe('Case ownership, next action and SLA target', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let caseManager: Awaited<ReturnType<typeof createStaff>>;
  let secondCaseManager: Awaited<ReturnType<typeof createStaff>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let agent: Awaited<ReturnType<typeof createAgent>>;

  let customerToken: string;
  let caseManagerToken: string;
  let adminToken: string;
  let agentToken: string;

  async function createCase(priority?: 'STANDARD' | 'PRIORITY' | 'URGENT'): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Ownership/SLA test case', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        serviceType: 'PROPERTY_INSPECTION',
        description: 'Inspect',
        location: 'Lagos',
        priority: priority ?? 'STANDARD',
      })
      .expect(201);
    const caseId: string = caseRes.body.id;

    // The admin who triaged it isn't a CaseCollaborator (ADMIN bypasses
    // CaseAccessGuard instead) — give the case manager real case access
    // the same way Ops actually would, so tests exercise the real guard.
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/claim`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .expect(201);

    return caseId;
  }

  beforeAll(async () => {
    app = await createTestApp();

    [customer, caseManager, secondCaseManager, admin, agent] = await Promise.all([
      createCustomer('ownersla'),
      createStaff('ownersla-cm', Role.CASE_MANAGER),
      createStaff('ownersla-cm2', Role.CASE_MANAGER),
      createStaff('ownersla-admin', Role.ADMIN),
      createAgent('ownersla-agent'),
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

  it('sets slaTargetAt automatically at case creation, ahead of now', async () => {
    const before = Date.now();
    const caseId = await createCase('STANDARD');
    const caseRow = await prisma.serviceCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(caseRow.slaTargetAt).not.toBeNull();
    expect(caseRow.slaTargetAt!.getTime()).toBeGreaterThan(before);
  });

  it('a tighter priority gets an earlier SLA target than STANDARD', async () => {
    const standardId = await createCase('STANDARD');
    const urgentId = await createCase('URGENT');
    const [standardCase, urgentCase] = await Promise.all([
      prisma.serviceCase.findUniqueOrThrow({ where: { id: standardId } }),
      prisma.serviceCase.findUniqueOrThrow({ where: { id: urgentId } }),
    ]);
    const standardWindow = standardCase.slaTargetAt!.getTime() - standardCase.createdAt.getTime();
    const urgentWindow = urgentCase.slaTargetAt!.getTime() - urgentCase.createdAt.getTime();
    expect(urgentWindow).toBeLessThan(standardWindow);
  });

  it('a case manager can assign themselves as owner, gaining case access and audit trail', async () => {
    const caseId = await createCase();
    const res = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/assign-owner`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ ownerUserId: caseManager.user.id })
      .expect(201);
    expect(res.body.ownerUserId).toBe(caseManager.user.id);

    const detail = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .expect(200);
    expect(detail.body.owner.email).toBe(caseManager.email);
  });

  it('rejects assigning a customer or field agent as case owner', async () => {
    const caseId = await createCase();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/assign-owner`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ ownerUserId: customer.user.id })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/assign-owner`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ ownerUserId: agent.user.id })
      .expect(400);
  });

  it('blocks a field agent from assigning case ownership entirely', async () => {
    const caseId = await createCase();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/assign-owner`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ ownerUserId: caseManager.user.id })
      .expect(403);
  });

  it('reassigning ownership to a different staff member overwrites, not duplicates, the owner', async () => {
    const caseId = await createCase();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/assign-owner`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ownerUserId: caseManager.user.id })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/assign-owner`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ownerUserId: secondCaseManager.user.id })
      .expect(201);
    expect(res.body.ownerUserId).toBe(secondCaseManager.user.id);
  });

  it('sets a next action with a due date, visible on the case detail and queue', async () => {
    const caseId = await createCase();
    const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/next-action`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ nextAction: 'Call customer to confirm access window', dueAt })
      .expect(201);
    expect(res.body.nextAction).toBe('Call customer to confirm access window');
    expect(new Date(res.body.nextActionDueAt).toISOString()).toBe(dueAt);

    const queue = await request(app.getHttpServer())
      .get('/api/cases')
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .expect(200);
    const row = queue.body.find((c: { id: string }) => c.id === caseId);
    expect(row.nextAction).toBe('Call customer to confirm access window');
  });

  it('rejects an empty next action', async () => {
    const caseId = await createCase();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/next-action`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ nextAction: '' })
      .expect(400);
  });

  it('records case.owner_assigned and case.next_action_set audit events', async () => {
    const caseId = await createCase();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/assign-owner`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ ownerUserId: caseManager.user.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/next-action`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ nextAction: 'Schedule field visit' })
      .expect(201);

    const events = await prisma.auditEvent.findMany({ where: { caseId }, select: { action: true } });
    const actions = events.map((e) => e.action);
    expect(actions).toContain('case.owner_assigned');
    expect(actions).toContain('case.next_action_set');
  });
});
