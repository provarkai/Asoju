import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 3 "Structured Request +
 * Eligibility Decision". Per the scope doc's own instruction: "resolve
 * AUTO at first to 'still requires staff convert' ... land the
 * decision-making and audit trail without yet removing the human from
 * case creation." Every test here confirms exactly that boundary: no
 * decision, however permissive, ever creates or converts a Case.
 */
describe('Automation eligibility engine (Phase 3)', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let otherCustomer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let caseManager: Awaited<ReturnType<typeof createStaff>>;
  let rm: Awaited<ReturnType<typeof createStaff>>;
  let customerToken: string;
  let otherCustomerToken: string;
  let adminToken: string;
  let caseManagerToken: string;
  let rmToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();
      [customer, otherCustomer, admin, caseManager, rm] = await Promise.all([
        createCustomer('automation'),
        createCustomer('automation-other'),
        createStaff('automation-admin', Role.ADMIN),
        createStaff('automation-cm', Role.CASE_MANAGER),
        createStaff('automation-rm', Role.RELATIONSHIP_MANAGER),
      ]);
      [customerToken, otherCustomerToken, adminToken, caseManagerToken, rmToken] = await Promise.all([
        login(app, customer.email),
        login(app, otherCustomer.email),
        login(app, admin.email),
        login(app, caseManager.email),
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

  function createRequest(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Automation test request', channel: 'web', ...body });
  }

  function patchRequest(id: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/api/service-requests/${id}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send(body);
  }

  function getDecision(id: string, token: string) {
    return request(app.getHttpServer())
      .get(`/api/service-requests/${id}/automation-decision`)
      .set('Authorization', `Bearer ${token}`);
  }

  it('is CUSTOMER_INPUT immediately at creation when no serviceType is supplied', async () => {
    const res = await createRequest({}).expect(201);
    const decision = await getDecision(res.body.id, customerToken).expect(200);
    expect(decision.body.outcome).toBe('CUSTOMER_INPUT');
    expect(decision.body.reason).toContain('Service type');
  });

  it('is UNSUPPORTED when serviceType is known but no AutomationCapability exists for it', async () => {
    const res = await createRequest({ serviceType: 'ASSET_INSPECTION' }).expect(201);
    const decision = await getDecision(res.body.id, customerToken).expect(200);
    expect(decision.body.outcome).toBe('UNSUPPORTED');
  });

  it('is ESCALATE when a capability exists but is disabled, and creates a real Escalation surfaced in the staff queue', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/automation/capabilities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROCUREMENT', enabled: false })
      .expect(201);

    const res = await createRequest({ serviceType: 'PROCUREMENT' }).expect(201);
    const decision = await getDecision(res.body.id, customerToken).expect(200);
    expect(decision.body.outcome).toBe('ESCALATE');
    expect(decision.body.escalationId).toBeTruthy();

    const escalation = await request(app.getHttpServer())
      .get(`/api/escalations/${decision.body.escalationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(escalation.body.reasonCategory).toBe('AUTOMATION_UNAVAILABLE');
    expect(escalation.body.serviceRequestId).toBe(res.body.id);
    expect(escalation.body.caseId).toBeNull();

    const queue = await request(app.getHttpServer())
      .get('/api/escalations')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(queue.body.some((e: { id: string }) => e.id === decision.body.escalationId)).toBe(true);
  });

  it('re-evaluating an already-ESCALATE-d request never creates a second Escalation', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/automation/capabilities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'INVESTMENT_SUPPORT', enabled: false })
      .expect(201);

    const res = await createRequest({ serviceType: 'INVESTMENT_SUPPORT' }).expect(201);
    const first = await getDecision(res.body.id, customerToken).expect(200);

    await patchRequest(res.body.id, { objective: 'Still the same request' }).expect(200);
    const second = await getDecision(res.body.id, customerToken).expect(200);

    expect(second.body.outcome).toBe('ESCALATE');
    expect(second.body.escalationId).toBe(first.body.escalationId);

    const count = await prisma.escalation.count({ where: { serviceRequestId: res.body.id } });
    expect(count).toBe(1);
  });

  it('reaches AUTO once every REQUIRED_FIELDS rule is satisfied, and never converts or creates a Case by itself', async () => {
    const capRes = await request(app.getHttpServer())
      .post('/api/admin/automation/capabilities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'AGRICULTURE_SUPPORT', enabled: true })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/automation/capabilities/${capRes.body.id}/rules`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ kind: 'REQUIRED_FIELDS', config: { fields: ['objective', 'timing'] } })
      .expect(201);

    const res = await createRequest({ serviceType: 'AGRICULTURE_SUPPORT' }).expect(201);
    const missing = await getDecision(res.body.id, customerToken).expect(200);
    expect(missing.body.outcome).toBe('CUSTOMER_INPUT');
    expect(missing.body.reason).toContain('objective');

    await patchRequest(res.body.id, { objective: 'Sourcing farm equipment', timing: 'This quarter' }).expect(200);
    const ready = await getDecision(res.body.id, customerToken).expect(200);
    expect(ready.body.outcome).toBe('AUTO');
    expect(ready.body.capabilityEnabled).toBe(true);

    // The non-negotiable this whole phase exists to prove: AUTO recorded,
    // but the request is still unconverted — staff triage is untouched.
    const stillOpen = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stillOpen.convertedCaseId).toBeNull();
  });

  it('BLOCKED wins over a missing required field — a blocked request is never CUSTOMER_INPUT', async () => {
    const capRes = await request(app.getHttpServer())
      .post('/api/admin/automation/capabilities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'BUSINESS_VERIFICATION', enabled: true })
      .expect(201);
    await Promise.all([
      request(app.getHttpServer())
        .post(`/api/admin/automation/capabilities/${capRes.body.id}/rules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kind: 'REQUIRED_FIELDS', config: { fields: ['objective'] } })
        .expect(201),
      request(app.getHttpServer())
        .post(`/api/admin/automation/capabilities/${capRes.body.id}/rules`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kind: 'BLOCKED_KEYWORDS', config: { keywords: ['forged'] } })
        .expect(201),
    ]);

    const res = await createRequest({
      serviceType: 'BUSINESS_VERIFICATION',
      rawDescription: 'Verify this forged incorporation document',
    }).expect(201);
    const decision = await getDecision(res.body.id, customerToken).expect(200);
    expect(decision.body.outcome).toBe('BLOCKED');
  });

  it('rejects a rule config with the wrong shape for its kind', async () => {
    const capRes = await request(app.getHttpServer())
      .post('/api/admin/automation/capabilities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'FAMILY_SUPPORT', enabled: true })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/automation/capabilities/${capRes.body.id}/rules`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ kind: 'REQUIRED_FIELDS', config: { notFields: ['objective'] } })
      .expect(400);
  });

  it('rejects a duplicate AutomationCapability for the same service type', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/automation/capabilities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'CONSTRUCTION_SUPERVISION', enabled: false })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/admin/automation/capabilities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'CONSTRUCTION_SUPERVISION', enabled: false })
      .expect(409);
  });

  it('rejects a non-Finance/Admin role from the admin capability/rule endpoints', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/automation/capabilities')
      .set('Authorization', `Bearer ${rmToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', enabled: false })
      .expect(403);
  });

  it('rejects a role outside the staff-triage set from the recompute trigger', async () => {
    const qc = await createStaff('automation-qc', Role.QUALITY_CONTROL);
    const qcToken = await login(app, qc.email);

    const res = await createRequest({}).expect(201);
    await request(app.getHttpServer())
      .post(`/api/service-requests/${res.body.id}/automation-decision/recompute`)
      .set('Authorization', `Bearer ${qcToken}`)
      .expect(403);

    // A Case Manager (in STAFF_TRIAGE_ROLES) can.
    await request(app.getHttpServer())
      .post(`/api/service-requests/${res.body.id}/automation-decision/recompute`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .expect(201);
  });

  it("a different customer cannot read another customer's automation decision (IDOR)", async () => {
    const res = await createRequest({}).expect(201);
    await getDecision(res.body.id, otherCustomerToken).expect(404);
  });

  it('rejects updating a request that has already converted to a case', async () => {
    const res = await createRequest({ serviceType: 'PROPERTY_INSPECTION', location: 'Lagos' }).expect(201);
    await request(app.getHttpServer())
      .post(`/api/service-requests/${res.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);

    await patchRequest(res.body.id, { objective: 'Too late' }).expect(400);
  });

  it('the kill switch flips ESCALATE to AUTO-eligible for an already-created request once re-evaluated', async () => {
    const capRes = await request(app.getHttpServer())
      .post('/api/admin/automation/capabilities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'HEALTHCARE_COORDINATION', enabled: false })
      .expect(201);

    const res = await createRequest({ serviceType: 'HEALTHCARE_COORDINATION' }).expect(201);
    const before = await getDecision(res.body.id, customerToken).expect(200);
    expect(before.body.outcome).toBe('ESCALATE');

    await request(app.getHttpServer())
      .patch(`/api/admin/automation/capabilities/HEALTHCARE_COORDINATION`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: true })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/service-requests/${res.body.id}/automation-decision/recompute`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .expect(201);

    const after = await getDecision(res.body.id, customerToken).expect(200);
    expect(after.body.outcome).toBe('AUTO');
    expect(capRes.body.serviceType).toBe('HEALTHCARE_COORDINATION');
  });
});
