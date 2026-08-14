import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Section 3.1 — customer dispute/rejection workflow. Real app, real
 * Postgres. Same "outside the static TRANSITIONS map" treatment as
 * case-hold-resume.e2e-spec.ts covers for ON_HOLD.
 *
 * Platform Expansion PRD §3.1's "structured gap form": disputes now
 * point at specific CaseTask checklist items (disputedTaskIds), not just
 * free text, and raising one reopens exactly those tasks as the rework
 * scope for the originally-assigned field agent.
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
   * QC approval that actually lands it in CUSTOMER_REVIEW. Returns the
   * case's seeded checklist task ids alongside the caseId so tests can
   * build a real structured gap form. */
  async function createCaseAtCustomerReview(): Promise<{ caseId: string; taskIds: string[] }> {
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

    const tasks = await prisma.caseTask.findMany({ where: { caseId }, orderBy: { sortOrder: 'asc' } });
    // Mark them complete first (as a real QC-approved case would have),
    // so raising a dispute has something meaningful to reopen.
    await prisma.caseTask.updateMany({ where: { caseId }, data: { isComplete: true, completedAt: new Date() } });

    return { caseId, taskIds: tasks.map((t) => t.id) };
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

  it('raises a dispute against specific checklist items, reopens exactly those, then staff resolves it back to ADDITIONAL_WORK', async () => {
    const { caseId, taskIds } = await createCaseAtCustomerReview();
    const disputedTaskIds = taskIds.slice(0, 2);
    const untouchedTaskIds = taskIds.slice(2);

    const raised = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/dispute`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ disputedTaskIds, reasons: ['Photos missing', 'Wrong address visited'], notes: 'Please redo' })
      .expect(201);
    expect(raised.body.status).toBe('OPEN');
    expect(raised.body.disputedTaskIds.sort()).toEqual([...disputedTaskIds].sort());
    expect(raised.body.reasons).toEqual(['Photos missing', 'Wrong address visited']);

    // The rework scope: exactly the disputed tasks reopened, everything
    // else the customer didn't flag stays completed.
    const disputedAfter = await prisma.caseTask.findMany({ where: { id: { in: disputedTaskIds } } });
    expect(disputedAfter.every((t) => t.isComplete === false)).toBe(true);
    if (untouchedTaskIds.length > 0) {
      const untouchedAfter = await prisma.caseTask.findMany({ where: { id: { in: untouchedTaskIds } } });
      expect(untouchedAfter.every((t) => t.isComplete === true)).toBe(true);
    }

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

  it('rejects raising a dispute with no disputed items', async () => {
    const { caseId } = await createCaseAtCustomerReview();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/dispute`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ disputedTaskIds: [] })
      .expect(400);
  });

  it("rejects a disputed item that isn't a checklist task on this case", async () => {
    const { caseId } = await createCaseAtCustomerReview();
    const { taskIds: otherCaseTaskIds } = await createCaseAtCustomerReview();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/dispute`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ disputedTaskIds: [otherCaseTaskIds[0]] })
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
      .send({ disputedTaskIds: ['too-early'] })
      .expect(400);
  });

  it('rejects resolving a dispute on a case that is not disputed', async () => {
    const { caseId } = await createCaseAtCustomerReview();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/dispute/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);
  });

  it('blocks a field agent from raising or resolving a dispute', async () => {
    const { caseId, taskIds } = await createCaseAtCustomerReview();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/dispute`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ disputedTaskIds: taskIds.slice(0, 1) })
      .expect(403);
  });

  it('the generic transition endpoint cannot be used to enter or leave DISPUTED', async () => {
    const { caseId, taskIds } = await createCaseAtCustomerReview();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ toStatus: 'DISPUTED' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/dispute`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ disputedTaskIds: taskIds.slice(0, 1), reasons: ['bad report'] })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ toStatus: 'ADDITIONAL_WORK' })
      .expect(400);
  });

  it('notifies the originally-assigned field agent when a dispute is raised against their work', async () => {
    const { caseId, taskIds } = await createCaseAtCustomerReview();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/dispute`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ disputedTaskIds: taskIds.slice(0, 1) })
      .expect(201);

    const notifications = await prisma.notification.findMany({
      where: { userId: agent.user.id, title: { contains: 'Rework needed' } },
    });
    expect(notifications.length).toBeGreaterThan(0);
  });

  it('records case.dispute_raised and case.dispute_resolved audit events', async () => {
    const { caseId, taskIds } = await createCaseAtCustomerReview();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/dispute`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ disputedTaskIds: taskIds.slice(0, 1), reasons: ['Missing evidence'] })
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
