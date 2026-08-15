import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Platform Expansion PRD §5.1 "Field Agent Tiering & Auto-Assignment" —
 * deterministic tier from performanceScore (ratings.service.ts, pre-
 * existing) + QC pass rate (QcReview, new this session). Real app, real
 * Postgres, real case/evidence/QC lifecycle — no shortcuts around the
 * tiering computation itself, only around the quote/payment chain that's
 * already covered elsewhere (same convention as qc-outcomes.e2e-spec.ts).
 */
describe('Field Agent Tiering', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let caseManager: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;
  let caseManagerToken: string;

  /** Fast-forwards a fresh case to EVIDENCE_SUBMITTED with the given agent
   * assigned and accepted — mirrors qc-outcomes.e2e-spec.ts's helper
   * exactly (DB-shortcut past the quote/payment chain). */
  async function createCaseAtEvidenceSubmitted(agentId: string, agentToken: string): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Agent tiering test case', location: 'Lagos', channel: 'web' })
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
      .send({ role: 'FIELD_AGENT', agentId })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/assignments/${assignRes.body.id}/accept`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(201);

    const uploadRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/evidence/upload-url`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ fileName: 'site.jpg', contentType: 'image/jpeg' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/evidence`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ type: 'PHOTO', storageKey: uploadRes.body.storageKey })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/evidence/complete`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(201);

    return caseId;
  }

  /** Runs one QC decision against a case at EVIDENCE_SUBMITTED — logs a
   * QcReview regardless of outcome and recomputes the agent's tier. */
  async function runQc(caseId: string, outcome: 'APPROVED' | 'REWORK' | 'PASS_WITH_LIMITATION') {
    const body: Record<string, string> = { outcome };
    if (outcome === 'APPROVED') body.summary = 'Inspection complete';
    if (outcome === 'PASS_WITH_LIMITATION') {
      body.summary = 'Inspection complete, one area inaccessible';
      body.note = 'Locked gate';
    }
    if (outcome === 'REWORK') body.note = 'Redo the rear elevation photos';

    return request(app.getHttpServer())
      .post(`/api/cases/${caseId}/qc`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(201);
  }

  async function qcCycle(agentId: string, agentToken: string, outcome: 'APPROVED' | 'REWORK' | 'PASS_WITH_LIMITATION') {
    const caseId = await createCaseAtEvidenceSubmitted(agentId, agentToken);
    await runQc(caseId, outcome);
    return caseId;
  }

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();

      [customer, admin, caseManager] = await Promise.all([
        createCustomer('agent-tiering'),
        createStaff('agent-tiering-admin', Role.ADMIN),
        createStaff('agent-tiering-cm', Role.CASE_MANAGER),
      ]);
      [customerToken, adminToken, caseManagerToken] = await Promise.all([
        login(app, customer.email),
        login(app, admin.email),
        login(app, caseManager.email),
      ]);

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

  it('computes qcPassRate from every QC outcome, not just the ones that produce a Report', async () => {
    const { agent, email } = await createAgent('tiering-mixed');
    const agentToken = await login(app, email);

    // APPROVED and PASS_WITH_LIMITATION both count as a pass; REWORK
    // doesn't — 2 of 3 pass. REWORK never creates a Report row, so this
    // also proves qcPassRate can't be sourced from Report.qcOutcome alone.
    await qcCycle(agent.id, agentToken, 'APPROVED');
    await qcCycle(agent.id, agentToken, 'REWORK');
    await qcCycle(agent.id, agentToken, 'PASS_WITH_LIMITATION');

    const updated = await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(updated.qcPassRate).toBeCloseTo(2 / 3, 5);
    // No performanceScore yet — stays BRONZE regardless of QC pass rate.
    expect(updated.tier).toBe('BRONZE');
  });

  it('stays BRONZE below the minimum QC sample size, even with a perfect record and a high rating', async () => {
    const { agent, email } = await createAgent('tiering-small-sample');
    const agentToken = await login(app, email);
    await prisma.agent.update({ where: { id: agent.id }, data: { performanceScore: 5 } });

    await qcCycle(agent.id, agentToken, 'APPROVED');
    await qcCycle(agent.id, agentToken, 'APPROVED');

    const updated = await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(updated.qcPassRate).toBe(1);
    expect(updated.tier).toBe('BRONZE');
  });

  it('reaches GOLD once a customer rating pushes performanceScore over the threshold, on top of an already-qualifying QC pass rate', async () => {
    const { agent, email } = await createAgent('tiering-gold');
    const agentToken = await login(app, email);

    await qcCycle(agent.id, agentToken, 'APPROVED');
    await qcCycle(agent.id, agentToken, 'APPROVED');
    const thirdCaseId = await qcCycle(agent.id, agentToken, 'APPROVED');

    let updated = await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(updated.qcPassRate).toBe(1);
    expect(updated.tier).toBe('BRONZE'); // qualifying QC pass rate, but no rating yet

    // ratableStatuses only cares about case status, not the full
    // quote/payment/approval chain — DB-shortcut straight to COMPLETED,
    // same convention as the rest of this file.
    await prisma.serviceCase.update({ where: { id: thirdCaseId }, data: { status: 'COMPLETED' } });
    await request(app.getHttpServer())
      .post(`/api/cases/${thirdCaseId}/rating`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ stars: 5 })
      .expect(201);

    updated = await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(updated.performanceScore).toBe(5);
    expect(updated.tier).toBe('GOLD');
  });

  it('agent-suggestions ranks GOLD above BRONZE and flags a Premium-subscribed customer', async () => {
    const { agent: goldAgent } = await createAgent('tiering-suggest-gold');
    await prisma.agent.update({ where: { id: goldAgent.id }, data: { performanceScore: 5, qcPassRate: 1, tier: 'GOLD' } });
    const { agent: bronzeAgent } = await createAgent('tiering-suggest-bronze');

    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Suggestion test case', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);
    const caseId = caseRes.body.id;

    // CaseAccessGuard requires CASE_MANAGER to be an explicit
    // CaseCollaborator (ADMIN/SUPER_ADMIN bypass this, CASE_MANAGER
    // doesn't) — claim is the self-service way onto a case, same as any
    // other Ops Console staff action.
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/claim`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .expect(201);

    const noSub = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/agent-suggestions`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .expect(200);
    expect(noSub.body.premiumCustomer).toBe(false);
    const ids = noSub.body.agents.map((a: { agentId: string }) => a.agentId);
    expect(ids.indexOf(goldAgent.id)).toBeLessThan(ids.indexOf(bronzeAgent.id));
    expect(noSub.body.agents.find((a: { agentId: string }) => a.agentId === goldAgent.id).tier).toBe('GOLD');

    await prisma.subscription.create({
      data: { customerId: customer.customer.id, plan: 'PREMIUM', status: 'ACTIVE' },
    });

    const withSub = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/agent-suggestions`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .expect(200);
    expect(withSub.body.premiumCustomer).toBe(true);
  });

  it('blocks a field agent from agent-suggestions and from the admin tiering sweep', async () => {
    const { agent, email } = await createAgent('tiering-blocked');
    const agentToken = await login(app, email);

    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Block test case', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/cases/${caseRes.body.id}/agent-suggestions`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/admin/agent-tiering/run')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(403);
  });

  it('the admin sweep endpoint recomputes every active agent on demand, matching the nightly cron', async () => {
    const { agent, email } = await createAgent('tiering-sweep');
    await prisma.agent.update({ where: { id: agent.id }, data: { performanceScore: 5 } });
    const agentToken = await login(app, email);
    await qcCycle(agent.id, agentToken, 'APPROVED');
    await qcCycle(agent.id, agentToken, 'APPROVED');
    await qcCycle(agent.id, agentToken, 'APPROVED');

    // Already GOLD from the recompute-on-QC hook — the sweep should agree,
    // not just report a non-zero count.
    const res = await request(app.getHttpServer())
      .post('/api/admin/agent-tiering/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.recomputed).toBeGreaterThanOrEqual(1);
    expect(res.body.tiers.GOLD).toBeGreaterThanOrEqual(1);

    const updated = await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(updated.tier).toBe('GOLD');
  });
});
