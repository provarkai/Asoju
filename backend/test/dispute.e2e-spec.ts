import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Section 3.1 — customer dispute/rejection workflow. Real app, real
 * Postgres. Same "outside the static TRANSITIONS map" treatment as
 * case-hold-resume.e2e-spec.ts covers for ON_HOLD.
 */
describe('Case dispute workflow', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let agent: Awaited<ReturnType<typeof createAgent>>;

  let customerToken: string;
  let adminToken: string;
  let agentToken: string;

  /** Fast-forwards a fresh case to CUSTOMER_REVIEW — same setup as
   * qc-outcomes.e2e-spec.ts's createCaseAtEvidenceSubmitted, plus the
   * QC approval that actually lands it in CUSTOMER_REVIEW. */
  async function createCaseAtCustomerReview(): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Dispute workflow test case', location: 'Lagos', channel: 'web' })
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

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/qc`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'APPROVED', summary: 'Inspection complete' })
      .expect(201);

    return caseId;
  }

  beforeAll(async () => {
    app = await createTestApp();

    [customer, admin, agent] = await Promise.all([
      createCustomer('dispute'),
      createStaff('dispute-admin', Role.ADMIN),
      createAgent('dispute-agent'),
    ]);
    [customerToken, adminToken, agentToken] = await Promise.all([
      login(app, customer.email),
      login(app, admin.email),
      login(app, agent.email),
    ]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('raises a dispute with structured reasons, then staff resolves it back to ADDITIONAL_WORK', async () => {
    const caseId = await createCaseAtCustomerReview();

    const raised = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/dispute`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reasons: ['Photos missing', 'Wrong address visited'], notes: 'Please redo' })
      .expect(201);
    expect(raised.body.status).toBe('OPEN');
    expect(raised.body.reasons).toEqual(['Photos missing', 'Wrong address visited']);

    const caseAfterRaise = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(caseAfterRaise.body.status).toBe('DISPUTED');

    const resolved = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/dispute/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Rework scheduled with agent' })
      .expect(201);
    expect(resolved.body.ok).toBe(true);

    const caseAfterResolve = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(caseAfterResolve.body.status).toBe('ADDITIONAL_WORK');

    const dispute = await prisma.dispute.findFirst({ where: { caseId } });
    expect(dispute?.status).toBe('RESOLVED');
    expect(dispute?.resolvedById).toBeTruthy();
  });

  it('rejects raising a dispute with no reasons', async () => {
    const caseId = await createCaseAtCustomerReview();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/dispute`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reasons: [] })
      .expect(400);
  });

  it('rejects raising a dispute on a case not in CUSTOMER_REVIEW', async () => {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Not yet ready for review', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/cases/${caseRes.body.id}/dispute`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reasons: ['too early'] })
      .expect(400);
  });

  it('rejects resolving a dispute on a case that is not disputed', async () => {
    const caseId = await createCaseAtCustomerReview();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/dispute/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);
  });

  it('blocks a field agent from raising or resolving a dispute', async () => {
    const caseId = await createCaseAtCustomerReview();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/dispute`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ reasons: ['trying anyway'] })
      .expect(403);
  });

  it('the generic transition endpoint cannot be used to enter or leave DISPUTED', async () => {
    const caseId = await createCaseAtCustomerReview();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ toStatus: 'DISPUTED' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/dispute`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reasons: ['bad report'] })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ toStatus: 'ADDITIONAL_WORK' })
      .expect(400);
  });

  it('records case.dispute_raised and case.dispute_resolved audit events', async () => {
    const caseId = await createCaseAtCustomerReview();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/dispute`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reasons: ['Missing evidence'] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/dispute/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const events = await prisma.auditEvent.findMany({
      where: { caseId, action: { in: ['case.dispute_raised', 'case.dispute_resolved'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.action)).toEqual(['case.dispute_raised', 'case.dispute_resolved']);
  });
});
