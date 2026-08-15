import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@prisma/client';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma } from './utils/fixtures';

/**
 * Ported from FieldForce's service-report-pdf.ts — real pdfkit render of
 * a case's completion report, served through the same authenticated
 * route/guard as GET cases/:caseId (CaseAccessGuard). No S3 bucket is
 * configured in CI, so StorageService runs in dry-run mode — this
 * confirms the route reaches a `downloadUrl` (the dry-run:// sentinel),
 * not that real bytes hit a real bucket (that's the storage.service unit
 * test's job, not this suite's).
 */
describe('Case completion report PDF', () => {
  let app: INestApplication;
  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let agent: Awaited<ReturnType<typeof createAgent>>;
  let customerToken: string;
  let adminToken: string;
  let agentToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();
      [customer, admin, agent] = await Promise.all([
        createCustomer('report-pdf'),
        createStaff('report-pdf-admin', Role.ADMIN),
        createAgent('report-pdf-agent'),
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

  /** Drives a fresh case all the way to an issued Report (same flow as
   * qc-outcomes.e2e-spec.ts), with a real check-in and one piece of
   * evidence so the PDF has real GPS/evidence data to render. */
  async function createCaseWithIssuedReport(): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Report PDF test case', location: 'Lagos', channel: 'web' })
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
    await request(app.getHttpServer())
      .post(`/api/assignments/${assignRes.body.id}/check-in`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ location: { lat: 6.5244, lng: 3.3792, accuracy: 15, capturedAt: new Date().toISOString() } })
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
      .send({ outcome: 'APPROVED', summary: 'Inspection complete, property in good condition' })
      .expect(201);

    return caseId;
  }

  it('renders a downloadable PDF for the customer who owns the case', async () => {
    const caseId = await createCaseWithIssuedReport();

    const res = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/report/pdf`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    expect(res.body.downloadUrl).toBeTruthy();
    expect(typeof res.body.downloadUrl).toBe('string');
  });

  it('caches the storage key on the Report row across repeated requests', async () => {
    const caseId = await createCaseWithIssuedReport();

    await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/report/pdf`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const report = await prisma.report.findFirstOrThrow({ where: { caseId } });
    expect(report.pdfStorageKey).toBeTruthy();

    // A second request reuses the cached key rather than generating a new one.
    await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/report/pdf`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const reportAfter = await prisma.report.findFirstOrThrow({ where: { caseId } });
    expect(reportAfter.pdfStorageKey).toBe(report.pdfStorageKey);
  });

  it('the assigned field agent can view the report PDF, an unrelated agent cannot', async () => {
    const caseId = await createCaseWithIssuedReport();
    const outsider = await createAgent('report-pdf-outsider');
    const outsiderToken = await login(app, outsider.email);

    await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/report/pdf`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/report/pdf`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
  });

  it('404s when the case has no issued report yet', async () => {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'No report yet', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/cases/${caseRes.body.id}/report/pdf`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(404);
  });

  it('blocks an unrelated customer entirely', async () => {
    const caseId = await createCaseWithIssuedReport();
    const outsider = await createCustomer('report-pdf-outsider-customer');
    const outsiderToken = await login(app, outsider.email);

    await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/report/pdf`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
  });
});
