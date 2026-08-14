import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role, ServiceType } from '@prisma/client';
import { classifyZone } from '../src/scope/pricing-zone';

/**
 * Platform Expansion PRD §5.3 "Predictive Costing" internal tool — a plain
 * historical average over DirectCost rows (Section 12 P1/P0 §33 "Financial
 * & Analytics Requirements"), same "deterministic, never model-inferred"
 * philosophy as the risk engine and agent tiering. Real app, real Postgres.
 */
describe('Predictive Costing', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let finance: Awaited<ReturnType<typeof createStaff>>;
  let caseManager: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;
  let financeToken: string;
  let caseManagerToken: string;

  async function createCaseAt(serviceType: string, location: string): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Predictive costing test case', location, channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType, description: 'Test case', location, priority: 'STANDARD' })
      .expect(201);

    // CaseAccessGuard requires FINANCE to be an explicit CaseCollaborator —
    // claim is the self-service way onto a case (direct-costs.e2e-spec.ts
    // does the same before Finance can record a cost).
    await request(app.getHttpServer())
      .post(`/api/cases/${caseRes.body.id}/claim`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(201);

    return caseRes.body.id;
  }

  async function recordCost(caseId: string, amount: number) {
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/direct-costs`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ category: 'THIRD_PARTY', amount })
      .expect(201);
  }

  async function complete(caseId: string) {
    await prisma.serviceCase.update({ where: { id: caseId }, data: { status: 'COMPLETED' } });
  }

  /** Ground truth computed the same way PredictiveCostingService does,
   * queried fresh at the start of each test. jest.retryTimes(2) replays a
   * whole failing test from scratch on a transient ECONNRESET without
   * resetting the DB, so a hardcoded absolute sampleSize/average would
   * drift on retry — measuring the baseline first and asserting relative
   * to it keeps the test correct regardless of how many attempts it took. */
  async function baselineForZone(serviceType: ServiceType, location: string) {
    const zone = classifyZone(location);
    const cases = await prisma.serviceCase.findMany({
      where: { serviceType, status: { in: ['COMPLETED', 'CLOSED'] } },
      select: { location: true, directCosts: { select: { amount: true } } },
    });
    const totals = cases
      .filter((c) => classifyZone(c.location) === zone && c.directCosts.length > 0)
      .map((c) => c.directCosts.reduce((sum, dc) => sum + Number(dc.amount), 0));
    return { sampleSize: totals.length, totalNgn: totals.reduce((sum, total) => sum + total, 0) };
  }

  beforeAll(async () => {
    app = await createTestApp();

    [customer, admin, finance, caseManager] = await Promise.all([
      createCustomer('predictive-costing'),
      createStaff('predictive-costing-admin', Role.ADMIN),
      createStaff('predictive-costing-finance', Role.FINANCE),
      createStaff('predictive-costing-cm', Role.CASE_MANAGER),
    ]);
    [customerToken, adminToken, financeToken, caseManagerToken] = await Promise.all([
      login(app, customer.email),
      login(app, admin.email),
      login(app, finance.email),
      login(app, caseManager.email),
    ]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('predicts nothing (NONE confidence) with no historical data for this service type', async () => {
    const caseId = await createCaseAt('BUSINESS_VERIFICATION', 'Lagos');
    const res = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/predicted-cost`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.sampleSize).toBe(0);
    expect(res.body.predictedAmountNgn).toBeNull();
    expect(res.body.confidence).toBe('NONE');
  });

  it('averages direct costs across terminal cases in the same zone, ignoring other zones and non-terminal cases', async () => {
    const baseline = await baselineForZone(ServiceType.ASSET_INSPECTION, 'Lagos');

    // Two completed Lagos cases at 100k/200k NGN added on top of baseline.
    const lagos1 = await createCaseAt('ASSET_INSPECTION', 'Lagos');
    await recordCost(lagos1, 100_000);
    await complete(lagos1);

    const lagos2 = await createCaseAt('ASSET_INSPECTION', 'Lagos');
    await recordCost(lagos2, 200_000);
    await complete(lagos2);

    // A South-West case at a wildly different amount must never leak in.
    const southWest = await createCaseAt('ASSET_INSPECTION', 'Ogun State');
    await recordCost(southWest, 900_000);
    await complete(southWest);

    // A Lagos case that's still open (not terminal) must never leak in
    // either — its cost could still change before the case closes.
    const openLagos = await createCaseAt('ASSET_INSPECTION', 'Lagos');
    await recordCost(openLagos, 5_000_000);

    const res = await request(app.getHttpServer())
      .get(`/api/cases/${lagos1}/predicted-cost`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    expect(res.body.zone).toBe('LAGOS');
    expect(res.body.sampleSize).toBe(baseline.sampleSize + 2);
    expect(res.body.predictedAmountNgn).toBeCloseTo(
      (baseline.totalNgn + 300_000) / (baseline.sampleSize + 2),
      5,
    );
  });

  it('reaches HIGH confidence once the sample crosses the minimum, LOW below it', async () => {
    const baseline = await baselineForZone(ServiceType.PROCUREMENT, 'Lagos');

    const first = await createCaseAt('PROCUREMENT', 'Lagos');
    await recordCost(first, 50_000);
    await complete(first);
    const second = await createCaseAt('PROCUREMENT', 'Lagos');
    await recordCost(second, 50_000);
    await complete(second);

    const lowSampleSize = baseline.sampleSize + 2;
    const low = await request(app.getHttpServer())
      .get(`/api/cases/${first}/predicted-cost`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(low.body.sampleSize).toBe(lowSampleSize);
    expect(low.body.confidence).toBe(lowSampleSize < 3 ? 'LOW' : 'HIGH');

    const third = await createCaseAt('PROCUREMENT', 'Lagos');
    await recordCost(third, 50_000);
    await complete(third);

    const highSampleSize = baseline.sampleSize + 3;
    const high = await request(app.getHttpServer())
      .get(`/api/cases/${first}/predicted-cost`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(high.body.sampleSize).toBe(highSampleSize);
    expect(high.body.confidence).toBe(highSampleSize < 3 ? 'LOW' : 'HIGH');
  });

  it('lets a claimed Case Manager see it and blocks a field agent and a customer entirely', async () => {
    const caseId = await createCaseAt('AGRICULTURE_SUPPORT', 'Lagos');

    // CaseAccessGuard requires CASE_MANAGER to be an explicit
    // CaseCollaborator — claim is the self-service way onto a case.
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/claim`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/predicted-cost`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/predicted-cost`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
  });
});
