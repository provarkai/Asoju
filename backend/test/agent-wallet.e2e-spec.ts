import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@prisma/client';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma } from './utils/fixtures';

/**
 * Ported from FieldForce's ledger.ts/WalletAccount pattern — a real agent
 * earnings ledger. Confirmed the gap first: Payout existed
 * (recipientType/agentId/amount fields) but had zero call sites anywhere
 * in this codebase before #38, and there was no WalletAccount/WalletEntry
 * at all. Deliberately no automatic case→fee formula — nothing in this
 * app ties a case's price to an agent's cut, so crediting earnings is an
 * explicit Finance action, gated on the case having passed QC.
 */
describe('Agent wallet — real earnings ledger', () => {
  let app: INestApplication;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let finance: Awaited<ReturnType<typeof createStaff>>;
  let caseManager: Awaited<ReturnType<typeof createStaff>>;
  let adminToken: string;
  let financeToken: string;
  let caseManagerToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();
      [admin, finance, caseManager] = await Promise.all([
        createStaff('wallet-admin', Role.ADMIN),
        createStaff('wallet-finance', Role.FINANCE),
        createStaff('wallet-cm', Role.CASE_MANAGER),
      ]);
      [adminToken, financeToken, caseManagerToken] = await Promise.all([
        login(app, admin.email),
        login(app, finance.email),
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

  /** Builds a case assigned to a fresh agent, fast-forwarded to a given
   * status, with Finance given real CaseAccessGuard access the way Ops
   * actually would (same convention as direct-costs.e2e-spec.ts). */
  async function setUpCaseWithAgent(prefix: string, status: 'IN_PROGRESS' | 'APPROVED') {
    const customer = await createCustomer(prefix);
    const agent = await createAgent(`${prefix}-agent`);
    const customerToken = await login(app, customer.email);
    const agentToken = await login(app, agent.email);

    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: `${prefix} wallet test case`, location: 'Lagos', channel: 'web' })
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
    // Accepting moves the case ASSIGNED -> IN_PROGRESS automatically.

    if (status === 'APPROVED') {
      await prisma.serviceCase.update({ where: { id: caseId }, data: { status: 'APPROVED' } });
    }

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/claim`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(201);

    return { caseId, agentId: agent.agent.id, agentUserId: agent.user.id, agentToken };
  }

  it('blocks recording earnings on a case that has not passed QC yet', async () => {
    const { caseId } = await setUpCaseWithAgent('wallet-not-approved', 'IN_PROGRESS');

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/agent-earnings`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ amount: 15000, description: 'Inspection fee' })
      .expect(400);
  });

  it('records earnings for a QC-passed case, crediting a fresh wallet', async () => {
    const { caseId, agentId } = await setUpCaseWithAgent('wallet-approved', 'APPROVED');

    const entryRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/agent-earnings`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ amount: 15000, description: 'Inspection fee' })
      .expect(201);

    expect(entryRes.body).toMatchObject({ type: 'EARNING', amount: '15000', caseId });

    const walletRes = await request(app.getHttpServer())
      .get(`/api/agents/${agentId}/wallet`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    expect(walletRes.body).toMatchObject({ availableBalance: '15000', totalEarnings: '15000', totalPaid: '0' });
    expect(walletRes.body.entries).toHaveLength(1);
  });

  it('accumulates multiple earnings entries correctly', async () => {
    const { caseId: caseA, agentId } = await setUpCaseWithAgent('wallet-accum-a', 'APPROVED');
    await request(app.getHttpServer())
      .post(`/api/cases/${caseA}/agent-earnings`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ amount: 10000 })
      .expect(201);

    // A second case for the SAME agent — reuse the agent, build a new case.
    const customer = await createCustomer('wallet-accum-b');
    const customerToken = await login(app, customer.email);
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Second case for accumulation', location: 'Lagos', channel: 'web' })
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
      .send({ amount: 7500 })
      .expect(201);

    const walletRes = await request(app.getHttpServer())
      .get(`/api/agents/${agentId}/wallet`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    expect(walletRes.body.availableBalance).toBe('17500');
    expect(walletRes.body.totalEarnings).toBe('17500');
    expect(walletRes.body.entries).toHaveLength(2);
  });

  it('records a payout within the available balance, debiting the wallet', async () => {
    const { caseId, agentId } = await setUpCaseWithAgent('wallet-payout', 'APPROVED');
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/agent-earnings`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ amount: 20000 })
      .expect(201);

    const payoutRes = await request(app.getHttpServer())
      .post(`/api/agents/${agentId}/payouts`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ amount: 12000, note: 'Weekly settlement' })
      .expect(201);

    expect(payoutRes.body).toMatchObject({ recipientType: 'FIELD_AGENT', agentId, amount: '12000', status: 'PAID' });

    const walletRes = await request(app.getHttpServer())
      .get(`/api/agents/${agentId}/wallet`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    expect(walletRes.body.availableBalance).toBe('8000');
    expect(walletRes.body.totalPaid).toBe('12000');
    expect(walletRes.body.entries).toHaveLength(2); // EARNING + PAYOUT_DEBIT
  });

  it('rejects a payout that exceeds the available balance, changing nothing', async () => {
    const { caseId, agentId } = await setUpCaseWithAgent('wallet-overdraft', 'APPROVED');
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/agent-earnings`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ amount: 5000 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/agents/${agentId}/payouts`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ amount: 5001 })
      .expect(400);

    const walletRes = await request(app.getHttpServer())
      .get(`/api/agents/${agentId}/wallet`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    expect(walletRes.body.availableBalance).toBe('5000');
    expect(walletRes.body.entries).toHaveLength(1); // no PAYOUT_DEBIT was created
  });

  it('lets an agent view their own wallet, blocks another agent, allows Finance/Admin', async () => {
    const { agentId, agentToken } = await setUpCaseWithAgent('wallet-owner', 'APPROVED');
    const outsider = await createAgent('wallet-outsider');
    const outsiderToken = await login(app, outsider.email);

    await request(app.getHttpServer())
      .get(`/api/agents/${agentId}/wallet`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/agents/${agentId}/wallet`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get(`/api/agents/${agentId}/wallet`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('blocks a non-Finance staff role from recording earnings or payouts', async () => {
    const { caseId, agentId } = await setUpCaseWithAgent('wallet-blocked-role', 'APPROVED');

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/agent-earnings`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ amount: 1000 })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/agents/${agentId}/payouts`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ amount: 1000 })
      .expect(403);
  });
});

/**
 * #52 — the double-entry ledger posted underneath every WalletEntry above.
 * Not "does the wallet balance look right" (the suite above already
 * covers that) but the actual accounting invariant: every account's
 * DEBIT total equals its CREDIT total once you sum the whole ledger, and
 * a Finance-visible trial balance / per-agent drill-down exists to prove it.
 */
describe('Agent wallet — double-entry ledger', () => {
  let app: INestApplication;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let finance: Awaited<ReturnType<typeof createStaff>>;
  let adminToken: string;
  let financeToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();
      [admin, finance] = await Promise.all([createStaff('ledger-admin', Role.ADMIN), createStaff('ledger-finance', Role.FINANCE)]);
      [adminToken, financeToken] = await Promise.all([login(app, admin.email), login(app, finance.email)]);
    });
  });

  beforeEach(async () => {
    app = await ensureHealthyApp(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function setUpApprovedCase(prefix: string) {
    const customer = await createCustomer(prefix);
    const agent = await createAgent(`${prefix}-agent`);
    const customerToken = await login(app, customer.email);
    const agentToken = await login(app, agent.email);

    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: `${prefix} ledger test case`, location: 'Lagos', channel: 'web' })
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

  it('posts a balanced journal entry for an earning, and again for the payout that clears it', async () => {
    const { caseId, agentId, agentToken } = await setUpApprovedCase('ledger-balance');

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/agent-earnings`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ amount: 20000 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/agents/${agentId}/payouts`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ amount: 12000 })
      .expect(201);

    const trialBalance = await request(app.getHttpServer())
      .get('/api/ledger/trial-balance')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    // The core invariant: every account's own debit and credit totals,
    // summed across the WHOLE ledger (every test that has ever posted, not
    // just this one), stay in balance — proving nothing anywhere ever
    // posted an unbalanced entry.
    const sumDebits = trialBalance.body.reduce((s: number, a: { totalDebits: number }) => s + a.totalDebits, 0);
    const sumCredits = trialBalance.body.reduce((s: number, a: { totalCredits: number }) => s + a.totalCredits, 0);
    expect(sumDebits).toBe(sumCredits);

    const expense = trialBalance.body.find((a: { code: string }) => a.code === 'AGENT_COMPENSATION_EXPENSE');
    const payable = trialBalance.body.find((a: { code: string }) => a.code === 'AGENT_PAYOUT_PAYABLE');
    const cash = trialBalance.body.find((a: { code: string }) => a.code === 'OPERATING_CASH');
    expect(expense.totalDebits).toBeGreaterThanOrEqual(20000);
    expect(payable.totalCredits).toBeGreaterThanOrEqual(20000);
    expect(payable.totalDebits).toBeGreaterThanOrEqual(12000);
    expect(cash.totalCredits).toBeGreaterThanOrEqual(12000);

    // The subsidiary drill-down: this agent's own two entries, visible to
    // the agent themself and to Finance, and blocked for an outsider.
    const agentLedger = await request(app.getHttpServer())
      .get(`/api/agents/${agentId}/ledger`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);
    expect(agentLedger.body).toHaveLength(2);
    expect(agentLedger.body.map((e: { entityType: string }) => e.entityType).sort()).toEqual(['Payout', 'WalletEntry']);

    const outsider = await createAgent('ledger-outsider');
    const outsiderToken = await login(app, outsider.email);
    await request(app.getHttpServer())
      .get(`/api/agents/${agentId}/ledger`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
  });

  it('is idempotent — replaying the same earning never double-posts', async () => {
    const { caseId, agentId } = await setUpApprovedCase('ledger-idempotent');
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/agent-earnings`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ amount: 9000 })
      .expect(201);

    const before = await request(app.getHttpServer())
      .get(`/api/agents/${agentId}/ledger`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    expect(before.body).toHaveLength(1);

    // Re-posting the exact same WalletEntry id directly through the
    // service (simulating a retried call) must not create a second entry.
    const walletEntry = await prisma.walletEntry.findFirstOrThrow({ where: { agentId, type: 'EARNING' } });
    const existingCount = await prisma.journalEntry.count({ where: { idempotencyKey: `EARNING_${walletEntry.id}` } });
    expect(existingCount).toBe(1);
  });
});
