import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * P0 Technical Build Spec Section 26 "QC Engine" — PASS_WITH_LIMITATION
 * ("Allows delivery with recorded limitation") and REVISIT_REQUIRED
 * ("Creates operational revisit task"), the two outcomes this shipped
 * without alongside the existing APPROVED/REWORK/ESCALATE/INCIDENT. Real
 * app, real Postgres.
 */
describe('QC outcomes: PASS_WITH_LIMITATION and REVISIT_REQUIRED', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let agent: Awaited<ReturnType<typeof createAgent>>;

  let customerToken: string;
  let adminToken: string;
  let agentToken: string;

  /** Fast-forwards a fresh case to EVIDENCE_SUBMITTED — one piece of
   * evidence captured, fieldwork marked complete — the state QC actually
   * operates on. Mirrors authorization.e2e-spec.ts's setup (DB-shortcut
   * past the quote/payment chain, already covered elsewhere) plus the
   * evidence steps this suite is actually about. */
  async function createCaseAtEvidenceSubmitted(): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'QC outcome taxonomy test case', location: 'Lagos', channel: 'web' })
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

    return caseId;
  }

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();

      [customer, admin, agent] = await Promise.all([
        createCustomer('qc-outcomes'),
        createStaff('qc-outcomes-admin', Role.ADMIN),
        createAgent('qc-outcomes-agent'),
      ]);
      [customerToken, adminToken, agentToken] = await Promise.all([
        login(app, customer.email),
        login(app, admin.email),
        login(app, agent.email),
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

  it('PASS_WITH_LIMITATION requires both summary and note, then issues a report with the limitation recorded', async () => {
    const caseId = await createCaseAtEvidenceSubmitted();

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/qc`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'PASS_WITH_LIMITATION', summary: 'Inspection complete' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/qc`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'PASS_WITH_LIMITATION', note: 'Could not access the rear boundary wall' })
      .expect(400);

    const res = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/qc`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        outcome: 'PASS_WITH_LIMITATION',
        summary: 'Inspection complete, one area inaccessible',
        note: 'Could not access the rear boundary wall — locked gate, no key available',
      })
      .expect(201);

    expect(res.body.outcome).toBe('PASS_WITH_LIMITATION');
    expect(res.body.report.qcOutcome).toBe('PASS_WITH_LIMITATION');
    expect(res.body.report.limitation).toContain('rear boundary wall');

    const caseDetail = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(caseDetail.body.status).toBe('CUSTOMER_REVIEW');
    expect(caseDetail.body.reports[0].limitation).toContain('rear boundary wall');
  });

  it('REVISIT_REQUIRED requires a note, sends the case back to IN_PROGRESS, and creates a required revisit task', async () => {
    const caseId = await createCaseAtEvidenceSubmitted();

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/qc`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'REVISIT_REQUIRED' })
      .expect(400);

    const res = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/qc`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'REVISIT_REQUIRED', note: 'Need photos of the north-facing wall in daylight' })
      .expect(201);

    expect(res.body.outcome).toBe('REVISIT_REQUIRED');
    expect(res.body.task.isRequired).toBe(true);
    expect(res.body.task.isComplete).toBe(false);
    expect(res.body.task.label).toContain('north-facing wall');

    const caseDetail = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(caseDetail.body.status).toBe('IN_PROGRESS');
    const revisitTask = caseDetail.body.tasks.find((t: { id: string }) => t.id === res.body.task.id);
    expect(revisitTask).toBeTruthy();
    expect(revisitTask.isComplete).toBe(false);

    // The same field agent can now complete the new task and resubmit —
    // the revisit task is a real, actionable checklist item, not just a
    // status-history note.
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/tasks/${res.body.task.id}/complete`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/evidence/complete`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(201);
  });
});
