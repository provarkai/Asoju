import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Section 12 P2 "advanced risk engine" — deterministic scoring
 * (RiskEngineService.assessCase), the Compliance/Risk queue
 * (GET risk/flagged-cases), and per-case assessment history
 * (GET cases/:caseId/risk-assessments). No dedicated e2e coverage existed
 * before this spec — the service is only ever exercised incidentally (as a
 * side effect of raising an exception or a QC outcome) elsewhere.
 */
describe('Risk engine', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let compliance: Awaited<ReturnType<typeof createStaff>>;
  let rm: Awaited<ReturnType<typeof createStaff>>;
  let customerToken: string;
  let adminToken: string;
  let complianceToken: string;
  let rmToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();
      [customer, admin, compliance, rm] = await Promise.all([
        createCustomer('risk'),
        createStaff('risk-admin', Role.ADMIN),
        createStaff('risk-compliance', Role.COMPLIANCE_RISK),
        createStaff('risk-rm', Role.RELATIONSHIP_MANAGER),
      ]);
      [customerToken, adminToken, complianceToken, rmToken] = await Promise.all([
        login(app, customer.email),
        login(app, admin.email),
        login(app, compliance.email),
        login(app, rm.email),
      ]);
    });
  });

  beforeEach(async () => {
    app = await ensureHealthyApp(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /** A case with no risk signals scores openRiskFlags=0 (level 1) by
   * default; `urgent` + 3 unresolved risk flags pushes the score to
   * exactly 4 (3 flags + 1 urgent-priority point), crossing the
   * HIGH_RISK_LEVEL=3 threshold deterministically. */
  async function createCase(opts: { urgent?: boolean; flags?: number } = {}): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Risk test case', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        serviceType: 'PROPERTY_INSPECTION',
        description: 'Inspect',
        location: 'Lagos',
        priority: opts.urgent ? 'URGENT' : 'STANDARD',
      })
      .expect(201);
    const caseId = caseRes.body.id;
    for (let i = 0; i < (opts.flags ?? 0); i++) {
      await prisma.caseRiskFlag.create({ data: { caseId, label: `Flag ${i}`, raisedById: admin.user.id } });
    }
    return caseId;
  }

  it('scores a clean, standard-priority case as level 1 with no automated flag raised', async () => {
    const caseId = await createCase();
    const res = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/risk-assessment`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.level).toBe(1);
    expect(res.body.score).toBe(0);

    const flags = await prisma.caseRiskFlag.findMany({ where: { caseId, label: 'Automated risk escalation' } });
    expect(flags).toHaveLength(0);
  });

  it('crosses HIGH_RISK_LEVEL with 3 open flags + urgent priority, and raises an automated flag exactly once', async () => {
    const caseId = await createCase({ urgent: true, flags: 3 });

    const first = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/risk-assessment`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(first.body.score).toBe(4);
    expect(first.body.level).toBe(3);

    // Re-assessing an already-high-risk case must not pile up duplicate
    // automated flags.
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/risk-assessment`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const updatedCase = await prisma.serviceCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(updatedCase.riskLevel).toBe(3);

    const flags = await prisma.caseRiskFlag.findMany({ where: { caseId, label: 'Automated risk escalation' } });
    expect(flags).toHaveLength(1);
  });

  it('lists per-case assessment history, most recent first', async () => {
    const caseId = await createCase({ flags: 1 });
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/risk-assessment`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/risk-assessment`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/risk-assessments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.length).toBe(2);
    expect(new Date(res.body[0].assessedAt).getTime()).toBeGreaterThanOrEqual(new Date(res.body[1].assessedAt).getTime());
  });

  it('surfaces a high-risk case in the org-wide flagged-cases queue for Compliance/Risk', async () => {
    const caseId = await createCase({ urgent: true, flags: 3 });
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/risk-assessment`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/risk/flagged-cases')
      .set('Authorization', `Bearer ${complianceToken}`)
      .expect(200);
    expect(res.body.some((c: { id: string }) => c.id === caseId)).toBe(true);
  });

  it('rejects a role outside the risk-review set (Relationship Manager) from the org-wide queue', async () => {
    await request(app.getHttpServer())
      .get('/api/risk/flagged-cases')
      .set('Authorization', `Bearer ${rmToken}`)
      .expect(403);
  });

  it('rejects a customer from assessing or reading risk on their own case', async () => {
    const caseId = await createCase();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/risk-assessment`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/risk-assessments`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
  });
});
