import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@prisma/client';
import { createTestApp } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma } from './utils/fixtures';

/**
 * Ported from FieldForce's sos-protocol.ts — trigger/acknowledge/resolve/
 * escalate with a 4-channel escalation chain. The one real adaptation:
 * a HIGH/CRITICAL alert against an active case calls this app's real
 * CasesService.holdCase() (enforced, auditable) instead of FieldForce's
 * passive evidenceLocked boolean.
 */
describe('Emergency SOS protocol', () => {
  let app: INestApplication;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await createStaff('sos-admin', Role.ADMIN);
    adminToken = await login(app, admin.email);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function setUpCaseWithAgent(prefix: string) {
    const customer = await createCustomer(prefix);
    const agent = await createAgent(`${prefix}-agent`);
    const customerToken = await login(app, customer.email);
    const agentToken = await login(app, agent.email);

    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: `${prefix} SOS test case`, location: 'Lagos', channel: 'web' })
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
    // Accepting moves the case ASSIGNED -> IN_PROGRESS automatically.

    return { caseId, agentId: agent.agent.id, agentToken };
  }

  it('rejects invalid GPS coordinates', async () => {
    const agent = await createAgent('sos-badcoords');
    const agentToken = await login(app, agent.email);

    await request(app.getHttpServer())
      .post('/api/agents/sos')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ alertType: 'GENERAL', severity: 'LOW', latitude: 999, longitude: 3.4 })
      .expect(400);
  });

  it('blocks a non-field-agent role from triggering an SOS alert', async () => {
    const customer = await createCustomer('sos-customer');
    const customerToken = await login(app, customer.email);

    await request(app.getHttpServer())
      .post('/api/agents/sos')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ alertType: 'GENERAL', severity: 'LOW', latitude: 6.5, longitude: 3.4 })
      .expect(403);
  });

  it('triggers a LOW-severity alert with no case — never holds anything', async () => {
    const agent = await createAgent('sos-low');
    const agentToken = await login(app, agent.email);

    const res = await request(app.getHttpServer())
      .post('/api/agents/sos')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ alertType: 'LOST', severity: 'LOW', latitude: 6.5244, longitude: 3.3792, message: 'Cannot find the property' })
      .expect(201);

    expect(res.body).toMatchObject({ status: 'ACTIVE', escalationLevel: 0, caseHeld: false });
  });

  it('a CRITICAL alert against an active case actually places the case ON_HOLD', async () => {
    const { caseId, agentToken } = await setUpCaseWithAgent('sos-critical');

    const res = await request(app.getHttpServer())
      .post('/api/agents/sos')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ alertType: 'SECURITY', severity: 'CRITICAL', latitude: 6.5, longitude: 3.4, caseId })
      .expect(201);

    expect(res.body.caseHeld).toBe(true);

    const serviceCase = await prisma.serviceCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(serviceCase.status).toBe('ON_HOLD');
    expect(serviceCase.heldFromStatus).toBe('IN_PROGRESS');
  });

  it('a LOW-severity alert against the same case does not hold it', async () => {
    const { caseId, agentToken } = await setUpCaseWithAgent('sos-low-case');

    const res = await request(app.getHttpServer())
      .post('/api/agents/sos')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ alertType: 'GENERAL', severity: 'LOW', latitude: 6.5, longitude: 3.4, caseId })
      .expect(201);

    expect(res.body.caseHeld).toBe(false);
    const serviceCase = await prisma.serviceCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(serviceCase.status).toBe('IN_PROGRESS');
  });

  it('404s when the caseId does not exist', async () => {
    const agent = await createAgent('sos-badcase');
    const agentToken = await login(app, agent.email);

    await request(app.getHttpServer())
      .post('/api/agents/sos')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ alertType: 'GENERAL', severity: 'HIGH', latitude: 6.5, longitude: 3.4, caseId: 'nonexistent-case-id' })
      .expect(404);
  });

  it('drives the full lifecycle: acknowledge -> escalate x2 -> resolve, rejecting invalid transitions', async () => {
    const agent = await createAgent('sos-lifecycle');
    const agentToken = await login(app, agent.email);

    const triggerRes = await request(app.getHttpServer())
      .post('/api/agents/sos')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ alertType: 'MEDICAL', severity: 'HIGH', latitude: 6.5, longitude: 3.4 })
      .expect(201);
    const alertId = triggerRes.body.id;

    // Cannot resolve before acknowledging is not actually required — but
    // escalating from ACTIVE should work.
    const escalate1 = await request(app.getHttpServer())
      .post(`/api/agents/sos/${alertId}/escalate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ channel: 'admin' })
      .expect(201);
    expect(escalate1.body).toMatchObject({ status: 'ESCALATED', escalationLevel: 1, escalatedChannels: ['admin'] });

    const ackRes = await request(app.getHttpServer())
      .post(`/api/agents/sos/${alertId}/acknowledge`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(ackRes.body.status).toBe('ACKNOWLEDGED');

    // Acknowledging again should fail — no longer ACTIVE/ESCALATED.
    await request(app.getHttpServer())
      .post(`/api/agents/sos/${alertId}/acknowledge`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    const escalate2 = await request(app.getHttpServer())
      .post(`/api/agents/sos/${alertId}/escalate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ channel: 'whatsapp' })
      .expect(201);
    expect(escalate2.body).toMatchObject({ status: 'ESCALATED', escalationLevel: 2, escalatedChannels: ['admin', 'whatsapp'] });

    const resolveRes = await request(app.getHttpServer())
      .post(`/api/agents/sos/${alertId}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolutionNotes: 'Agent confirmed safe, false GPS drift' })
      .expect(201);
    expect(resolveRes.body).toMatchObject({ status: 'RESOLVED', resolutionNotes: 'Agent confirmed safe, false GPS drift' });

    // Resolving again should fail — terminal status.
    await request(app.getHttpServer())
      .post(`/api/agents/sos/${alertId}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolutionNotes: 'try again' })
      .expect(400);

    // Escalating a resolved alert should also fail.
    await request(app.getHttpServer())
      .post(`/api/agents/sos/${alertId}/escalate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ channel: 'police' })
      .expect(400);
  });

  it('marks a false alarm distinctly from a real resolution', async () => {
    const agent = await createAgent('sos-falsealarm');
    const agentToken = await login(app, agent.email);

    const triggerRes = await request(app.getHttpServer())
      .post('/api/agents/sos')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ alertType: 'SAFETY', severity: 'MEDIUM', latitude: 6.5, longitude: 3.4 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/agents/sos/${triggerRes.body.id}/false-alarm`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolutionNotes: 'Agent triggered accidentally' })
      .expect(201);

    expect(res.body.status).toBe('FALSE_ALARM');
  });

  it('lists only ACTIVE/ACKNOWLEDGED/ESCALATED alerts as active, excluding terminal ones', async () => {
    const agent = await createAgent('sos-activelist');
    const agentToken = await login(app, agent.email);

    const activeRes = await request(app.getHttpServer())
      .post('/api/agents/sos')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ alertType: 'GENERAL', severity: 'LOW', latitude: 6.5, longitude: 3.4 })
      .expect(201);

    const resolvedTrigger = await request(app.getHttpServer())
      .post('/api/agents/sos')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ alertType: 'GENERAL', severity: 'LOW', latitude: 6.5, longitude: 3.4 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/agents/sos/${resolvedTrigger.body.id}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolutionNotes: 'handled' })
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get('/api/agents/sos/active')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const ids = listRes.body.map((a: { id: string }) => a.id);
    expect(ids).toContain(activeRes.body.id);
    expect(ids).not.toContain(resolvedTrigger.body.id);
  });

  it('scopes history to the caller: a field agent only ever sees their own, staff can see anyone', async () => {
    const agentA = await createAgent('sos-hist-a');
    const agentATokenPromise = login(app, agentA.email);
    const agentB = await createAgent('sos-hist-b');
    const [agentAToken, agentBToken] = await Promise.all([agentATokenPromise, login(app, agentB.email)]);

    await request(app.getHttpServer())
      .post('/api/agents/sos')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({ alertType: 'GENERAL', severity: 'LOW', latitude: 6.5, longitude: 3.4 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/agents/sos')
      .set('Authorization', `Bearer ${agentBToken}`)
      .send({ alertType: 'GENERAL', severity: 'LOW', latitude: 6.5, longitude: 3.4 })
      .expect(201);

    // Agent A only ever sees their own, even if they pass agentB's id as a filter.
    const agentAHistory = await request(app.getHttpServer())
      .get(`/api/agents/sos/history?agentId=${agentB.agent.id}`)
      .set('Authorization', `Bearer ${agentAToken}`)
      .expect(200);
    expect(agentAHistory.body.every((a: { agentId: string }) => a.agentId === agentA.agent.id)).toBe(true);

    // Staff filtering by agentId gets exactly that agent's history.
    const staffFiltered = await request(app.getHttpServer())
      .get(`/api/agents/sos/history?agentId=${agentB.agent.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(staffFiltered.body.every((a: { agentId: string }) => a.agentId === agentB.agent.id)).toBe(true);
    expect(staffFiltered.body.length).toBeGreaterThan(0);
  });
});
