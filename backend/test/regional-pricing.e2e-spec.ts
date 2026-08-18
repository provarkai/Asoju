import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma, verifySubscriptionFirstPayment } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Platform Expansion PRD §2.2 "Variable Quoting Engine (Region-Based
 * Pricing)" / §2.3 "SC Exclusion Rule" — real app, real Postgres, no
 * mocks. Covers what membership.e2e-spec.ts doesn't: zone classification
 * from location, the regional-pricing-hint endpoint, and specifically the
 * margin-protection case membership.e2e-spec.ts's Lagos-only fixtures
 * never exercise — SC being withheld (but the tier discount staying)
 * once a case is scoped to an "Other Location."
 */
describe('Region-based quoting engine', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let agent: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;
  let agentToken: string;

  /** Fast-forwards a fresh CONCIERGE-tier case to UNDER_REVIEW with an
   * unconfirmed scope, letting the caller choose the location (drives
   * classifyZone) and optionally an explicit zone override. Mirrors
   * membership.e2e-spec.ts's createConciergeCaseUnderReview but stops
   * short of scope confirmation so tests can inspect the classified zone
   * first. */
  async function createConciergeCaseWithScope(
    location: string,
    priority: 'STANDARD' | 'URGENT' = 'STANDARD',
    zoneOverride?: string,
  ): Promise<{ caseId: string; scope: any }> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Regional pricing test case', location, channel: 'web' })
      .expect(201);

    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        serviceType: 'FAMILY_SUPPORT',
        description: 'Concierge case',
        location,
        priority,
        tier: 'CONCIERGE',
      })
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

    const scopeRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        objective: 'Handle the request',
        tasks: ['Visit site', 'Compile report'],
        ...(zoneOverride ? { zone: zoneOverride } : {}),
      })
      .expect(201);

    return { caseId, scope: scopeRes.body };
  }

  async function confirmScope(caseId: string) {
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope/confirm`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
  }

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();

      [customer, admin, agent] = await Promise.all([
        createCustomer('regional-pricing'),
        createStaff('regional-pricing-admin', Role.ADMIN),
        createStaff('regional-pricing-agent', Role.FIELD_AGENT),
      ]);
      [customerToken, adminToken, agentToken] = await Promise.all([
        login(app, customer.email),
        login(app, admin.email),
        login(app, agent.email),
      ]);

      const subRes = await request(app.getHttpServer())
        .post('/api/me/subscription')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ plan: 'PRIORITY' })
        .expect(201);
      // subscribe() only creates a PENDING subscription now — the
      // discount/SC math below relies on it being live from the start, so
      // confirm the (dry-run, in this env) payment here.
      await verifySubscriptionFirstPayment(app, subRes.body.id);
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

  it('classifies a Lagos case as LAGOS, a South-West state as SOUTH_WEST, and anywhere else as OTHER', async () => {
    const { scope: lagos } = await createConciergeCaseWithScope('Lagos, Nigeria');
    expect(lagos.zone).toBe('LAGOS');

    const { scope: sw } = await createConciergeCaseWithScope('Ibadan, Oyo State');
    expect(sw.zone).toBe('SOUTH_WEST');

    const { scope: other } = await createConciergeCaseWithScope('Kano');
    expect(other.zone).toBe('OTHER');
  });

  it('lets staff override the classified zone at scoping time', async () => {
    // "Lagos" would classify as LAGOS by default — an explicit override
    // (e.g. a diaspora client describing a Lagos-adjacent but effectively
    // remote location) wins.
    const { scope } = await createConciergeCaseWithScope('Lagos', 'STANDARD', 'OTHER');
    expect(scope.zone).toBe('OTHER');
  });

  it('regional-pricing-hint: Lagos $50, South-West $80, Other unpriced — with the 1.5x urgency multiplier on URGENT', async () => {
    const { caseId: lagosStandard } = await createConciergeCaseWithScope('Lagos');
    const lagosHint = await request(app.getHttpServer())
      .get(`/api/cases/${lagosStandard}/regional-pricing-hint`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(lagosHint.body.zone).toBe('LAGOS');
    expect(lagosHint.body.baseRateUsd).toBe(50);
    expect(lagosHint.body.suggestedServiceFeeUsd).toBe(50);
    expect(lagosHint.body.scEligible).toBe(true);

    const { caseId: lagosUrgent } = await createConciergeCaseWithScope('Lagos', 'URGENT');
    const urgentHint = await request(app.getHttpServer())
      .get(`/api/cases/${lagosUrgent}/regional-pricing-hint`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(urgentHint.body.suggestedServiceFeeUsd).toBe(75); // 50 * 1.5
    expect(urgentHint.body.urgencyMultiplierApplied).toBe(true);

    const { caseId: swCase } = await createConciergeCaseWithScope('Ibadan, Oyo State');
    const swHint = await request(app.getHttpServer())
      .get(`/api/cases/${swCase}/regional-pricing-hint`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(swHint.body.zone).toBe('SOUTH_WEST');
    expect(swHint.body.baseRateUsd).toBe(80);
    expect(swHint.body.scEligible).toBe(true);

    const { caseId: otherCase } = await createConciergeCaseWithScope('Kano');
    const otherHint = await request(app.getHttpServer())
      .get(`/api/cases/${otherCase}/regional-pricing-hint`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(otherHint.body.zone).toBe('OTHER');
    expect(otherHint.body.baseRateUsd).toBeNull();
    expect(otherHint.body.suggestedServiceFeeUsd).toBeNull();
    expect(otherHint.body.scEligible).toBe(false);
  });

  it('rejects a pricing hint request for a case with no scope yet', async () => {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'No scope yet', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'FAMILY_SUPPORT', description: 'No scope on this one', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/cases/${caseRes.body.id}/regional-pricing-hint`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('blocks a field agent from viewing the pricing hint', async () => {
    const { caseId } = await createConciergeCaseWithScope('Lagos');
    await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/regional-pricing-hint`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(403);
  });

  it('SC Exclusion Rule: a case scoped to an Other Location keeps the tier discount but gets zero SC applied', async () => {
    const { caseId } = await createConciergeCaseWithScope('Kano');
    await confirmScope(caseId);

    const quoteRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/quotes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [{ category: 'ASOJU_SERVICE_FEE', label: 'ASOJU service fee', amount: 100000 }] })
      .expect(201);

    // 10% Priority discount still applies (100,000 -> 10,000 off), but SC
    // is withheld entirely because the zone is OTHER — the customer pays
    // the discounted amount in full, not the SC-reduced one.
    expect(Number(quoteRes.body.discountPercent)).toBe(10);
    expect(Number(quoteRes.body.discountAmount)).toBe(10000);
    expect(Number(quoteRes.body.scAppliedNgn)).toBe(0);
    expect(Number(quoteRes.body.amount)).toBe(90000);
  });

  it('a South-West case is not excluded — SC applies there same as Lagos', async () => {
    const { caseId } = await createConciergeCaseWithScope('Ibadan, Oyo State');
    await confirmScope(caseId);

    const quoteRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/quotes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [{ category: 'ASOJU_SERVICE_FEE', label: 'ASOJU service fee', amount: 100000 }] })
      .expect(201);

    expect(Number(quoteRes.body.discountAmount)).toBe(10000);
    expect(Number(quoteRes.body.scAppliedNgn)).toBeGreaterThan(0);
  });
});
