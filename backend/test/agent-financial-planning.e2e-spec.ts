import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@prisma/client';
import { createTestApp, ensureHealthyApp } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma } from './utils/fixtures';

/**
 * Ported from FieldForce's financial-planning.ts, built on #38's real
 * WalletEntry ledger (type 'EARNING') instead of a fabricated formula.
 * The API itself never accepts a custom createdAt, so month-bucketing is
 * verified by directly backdating a WalletEntry's createdAt via Prisma
 * after crediting it through the real earnings endpoint — same "drive the
 * real flow, then fast-forward what the API doesn't expose" convention
 * used throughout this suite.
 */
describe('Agent financial planning — projection built on the real wallet ledger', () => {
  let app: INestApplication;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let finance: Awaited<ReturnType<typeof createStaff>>;
  let adminToken: string;
  let financeToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    [admin, finance] = await Promise.all([
      createStaff('finplan-admin', Role.ADMIN),
      createStaff('finplan-finance', Role.FINANCE),
    ]);
    [adminToken, financeToken] = await Promise.all([login(app, admin.email), login(app, finance.email)]);
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

  async function setUpCaseWithAgent(prefix: string) {
    const customer = await createCustomer(prefix);
    const agent = await createAgent(`${prefix}-agent`);
    const customerToken = await login(app, customer.email);
    const agentToken = await login(app, agent.email);

    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: `${prefix} financial planning test case`, location: 'Lagos', channel: 'web' })
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
    await prisma.serviceCase.update({ where: { id: caseId }, data: { status: 'APPROVED' } });
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/claim`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(201);

    return { caseId, agentId: agent.agent.id, agentToken };
  }

  it('returns a no_history plan for an agent with no earnings yet', async () => {
    const agent = await createAgent('finplan-fresh');
    const agentToken = await login(app, agent.email);

    const res = await request(app.getHttpServer())
      .get(`/api/agents/${agent.agent.id}/financial-plan`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(res.body.history).toEqual([]);
    expect(res.body.projection).toMatchObject({ basis: 'no_history', trailingAverageMonthlyNaira: 0 });
    expect(res.body.savingsPlan).toMatchObject({ recommendedMonthlySavingsNaira: 0 });
    expect(res.body.taxEstimate.totalEstimatedTaxNaira).toBe(0);
  });

  it('projects earnings off real WalletEntry history, bucketed by month', async () => {
    const { caseId, agentId } = await setUpCaseWithAgent('finplan-history');

    const entryRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/agent-earnings`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ amount: 60000, description: 'Inspection fee' })
      .expect(201);

    // Backdate this entry to last month so the plan has to bucket by
    // month rather than just seeing everything as "this month".
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    lastMonth.setDate(15);
    await prisma.walletEntry.update({ where: { id: entryRes.body.id }, data: { createdAt: lastMonth } });

    // A second earning this month, same agent, different case.
    const customer = await createCustomer('finplan-history-b');
    const customerToken = await login(app, customer.email);
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Second case', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);
    const caseB = caseRes.body.id;
    await prisma.serviceCase.update({ where: { id: caseB }, data: { status: 'SCHEDULED', paymentStatus: 'PAID' } });
    const assignRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseB}/assignments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'FIELD_AGENT', agentId })
      .expect(201);
    const agentUser = await prisma.agent.findUniqueOrThrow({ where: { id: agentId }, include: { user: true } });
    const agentToken2 = await login(app, agentUser.user.email!);
    await request(app.getHttpServer())
      .post(`/api/assignments/${assignRes.body.id}/accept`)
      .set('Authorization', `Bearer ${agentToken2}`)
      .expect(201);
    await prisma.serviceCase.update({ where: { id: caseB }, data: { status: 'APPROVED' } });
    await request(app.getHttpServer())
      .post(`/api/cases/${caseB}/claim`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseB}/agent-earnings`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ amount: 40000 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/agents/${agentId}/financial-plan`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    expect(res.body.history).toHaveLength(2);
    const totals = res.body.history.map((m: { totalNaira: number }) => m.totalNaira).sort((a: number, b: number) => a - b);
    expect(totals).toEqual([40000, 60000]);

    // trailing average across the 2 months = (60000+40000)/2 = 50000
    expect(res.body.projection).toMatchObject({
      basis: 'trailing_average',
      monthsOfHistory: 2,
      trailingAverageMonthlyNaira: 50000,
      projectedNextMonthNaira: 50000,
      projectedNextQuarterNaira: 150000,
      projectedNextYearNaira: 600000,
    });

    // savings plan defaults to 15% of the trailing average
    expect(res.body.savingsPlan).toMatchObject({
      recommendedRatePercent: 15,
      recommendedMonthlySavingsNaira: 7500,
    });

    // tax estimate runs off the projected annual figure (600,000)
    expect(res.body.taxEstimate.grossAnnualIncomeNaira).toBe(600000);
    expect(res.body.taxEstimate.disclaimer).toMatch(/Not certified tax advice/);
  });

  it('lets an agent view their own plan, blocks another agent, allows Finance/Admin', async () => {
    const { agentId, agentToken } = await setUpCaseWithAgent('finplan-owner');
    const outsider = await createAgent('finplan-outsider');
    const outsiderToken = await login(app, outsider.email);

    await request(app.getHttpServer())
      .get(`/api/agents/${agentId}/financial-plan`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/agents/${agentId}/financial-plan`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get(`/api/agents/${agentId}/financial-plan`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });
});
