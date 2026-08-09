import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import {
  DEFAULT_PASSWORD,
  createAgent,
  createCustomer,
  createPartnerContact,
  createStaff,
  prisma,
} from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * P0-03 "Authorization hardening" (independent readiness review) —
 * automated regression coverage for Non-Negotiable #6 ("no sensitive
 * access without permission — case-scoped, not just role-scoped") and the
 * report's Section 7 "operations visibility vs. case-content access"
 * distinction. Every request here goes through the real app (real guards,
 * real Postgres) — nothing is mocked.
 */
describe('Authorization (IDOR/BOLA)', () => {
  let app: INestApplication;

  // Fixtures shared across the whole file, built once in beforeAll.
  let customerA: Awaited<ReturnType<typeof createCustomer>>;
  let customerB: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let caseManager: Awaited<ReturnType<typeof createStaff>>; // never made a collaborator
  let ownAgent: Awaited<ReturnType<typeof createAgent>>; // assigned to the case
  let strangerAgent: Awaited<ReturnType<typeof createAgent>>; // never assigned
  let partner: Awaited<ReturnType<typeof createPartnerContact>>;

  let tokenA: string;
  let tokenB: string;
  let adminToken: string;
  let caseManagerToken: string;
  let ownAgentToken: string;
  let strangerAgentToken: string;
  let partnerToken: string;

  let caseId: string;
  let allVisibleDocId: string;
  let staffOnlyDocId: string;

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);
    return res.body.accessToken;
  }

  beforeAll(async () => {
    app = await createTestApp();

    [customerA, customerB, admin, caseManager, ownAgent, strangerAgent, partner] = await Promise.all([
      createCustomer('authz-a'),
      createCustomer('authz-b'),
      createStaff('authz-admin', Role.ADMIN),
      createStaff('authz-cm', Role.CASE_MANAGER),
      createAgent('authz-own'),
      createAgent('authz-stranger'),
      createPartnerContact('authz'),
    ]);

    [tokenA, tokenB, adminToken, caseManagerToken, ownAgentToken, strangerAgentToken, partnerToken] =
      await Promise.all([
        login(customerA.email),
        login(customerB.email),
        login(admin.email),
        login(caseManager.email),
        login(ownAgent.email),
        login(strangerAgent.email),
        login(partner.email),
      ]);

    // Build a real case for customer A: request -> admin converts -> admin
    // assigns ownAgent -> agent accepts (case moves to IN_PROGRESS).
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ rawDescription: 'Inspect my property', location: 'Lagos', channel: 'web' })
      .expect(201);

    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);
    caseId = caseRes.body.id;

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

    // Fast-forward past quote/payment (Quote -> accept -> webhook — already
    // covered by its own manual + unit verification) straight to SCHEDULED,
    // the state assignment creation requires. This suite is about
    // authorization on top of that state, not the payment chain itself.
    await prisma.serviceCase.update({ where: { id: caseId }, data: { status: 'SCHEDULED', paymentStatus: 'PAID' } });

    const assignRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/assignments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'FIELD_AGENT', agentId: ownAgent.agent.id })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/assignments/${assignRes.body.id}/accept`)
      .set('Authorization', `Bearer ${ownAgentToken}`)
      .expect(201);

    // One unrestricted document and one staff-only document, for the
    // document-classification tests below.
    const allDoc = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Access instructions', storageKey: 'docs/access.pdf', visibility: 'ALL' })
      .expect(201);
    allVisibleDocId = allDoc.body.id;

    const staffDoc = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Internal risk note', storageKey: 'docs/risk.pdf', visibility: 'STAFF_ONLY' })
      .expect(201);
    staffOnlyDocId = staffDoc.body.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('unauthenticated access', () => {
    it('rejects a request with no token', async () => {
      await request(app.getHttpServer()).get(`/api/cases/${caseId}`).expect(401);
    });

    it('rejects a request with a garbage token', async () => {
      await request(app.getHttpServer()).get(`/api/cases/${caseId}`).set('Authorization', 'Bearer not-a-real-token').expect(401);
    });
  });

  describe('cross-customer IDOR', () => {
    it("blocks customer B from reading customer A's case by guessing/changing the ID", async () => {
      await request(app.getHttpServer()).get(`/api/cases/${caseId}`).set('Authorization', `Bearer ${tokenB}`).expect(403);
    });

    it("blocks customer B from reading customer A's case documents", async () => {
      await request(app.getHttpServer()).get(`/api/cases/${caseId}/documents`).set('Authorization', `Bearer ${tokenB}`).expect(403);
    });

    it("blocks customer B's own case list from ever containing customer A's case", async () => {
      const res = await request(app.getHttpServer()).get('/api/cases').set('Authorization', `Bearer ${tokenB}`).expect(200);
      expect(res.body.find((c: { id: string }) => c.id === caseId)).toBeUndefined();
    });

    it('lets customer A read their own case', async () => {
      const res = await request(app.getHttpServer()).get(`/api/cases/${caseId}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(res.body.id).toBe(caseId);
    });
  });

  describe('field actor BOLA (assignment-scoped access)', () => {
    it('blocks an agent with no assignment on this case', async () => {
      await request(app.getHttpServer()).get(`/api/cases/${caseId}`).set('Authorization', `Bearer ${strangerAgentToken}`).expect(403);
    });

    it('lets the assigned agent read the case', async () => {
      const res = await request(app.getHttpServer()).get(`/api/cases/${caseId}`).set('Authorization', `Bearer ${ownAgentToken}`).expect(200);
      expect(res.body.id).toBe(caseId);
    });

    it('blocks the unassigned agent from submitting evidence', async () => {
      await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/evidence`)
        .set('Authorization', `Bearer ${strangerAgentToken}`)
        .send({ type: 'NOTE', storageKey: 'x' })
        .expect(403);
    });
  });

  describe('operations visibility vs. case-content access (report Section 7.1)', () => {
    it('lets an unassigned case manager see the case in the org-wide queue (metadata only)', async () => {
      const res = await request(app.getHttpServer()).get('/api/cases').set('Authorization', `Bearer ${caseManagerToken}`).expect(200);
      expect(res.body.some((c: { id: string }) => c.id === caseId)).toBe(true);
    });

    it('still blocks that same unassigned case manager from full case detail until they claim it', async () => {
      await request(app.getHttpServer()).get(`/api/cases/${caseId}`).set('Authorization', `Bearer ${caseManagerToken}`).expect(403);
    });

    it('lets them in after self-claiming, proving claim (not role alone) is what grants access', async () => {
      await request(app.getHttpServer()).post(`/api/cases/${caseId}/claim`).set('Authorization', `Bearer ${caseManagerToken}`).expect(201);
      await request(app.getHttpServer()).get(`/api/cases/${caseId}`).set('Authorization', `Bearer ${caseManagerToken}`).expect(200);
    });
  });

  describe('document classification (report P0-04)', () => {
    it('shows the assigned agent the unrestricted document', async () => {
      const res = await request(app.getHttpServer()).get(`/api/cases/${caseId}`).set('Authorization', `Bearer ${ownAgentToken}`).expect(200);
      const ids = res.body.documents.map((d: { id: string }) => d.id);
      expect(ids).toContain(allVisibleDocId);
    });

    it('hides the STAFF_ONLY document from the assigned agent', async () => {
      const res = await request(app.getHttpServer()).get(`/api/cases/${caseId}`).set('Authorization', `Bearer ${ownAgentToken}`).expect(200);
      const ids = res.body.documents.map((d: { id: string }) => d.id);
      expect(ids).not.toContain(staffOnlyDocId);
    });

    it('hides the STAFF_ONLY document from the dedicated documents endpoint too', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/cases/${caseId}/documents`)
        .set('Authorization', `Bearer ${ownAgentToken}`)
        .expect(200);
      const ids = res.body.map((d: { id: string }) => d.id);
      expect(ids).not.toContain(staffOnlyDocId);
    });

    it('shows staff (admin) every document regardless of classification', async () => {
      const res = await request(app.getHttpServer()).get(`/api/cases/${caseId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      const ids = res.body.documents.map((d: { id: string }) => d.id);
      expect(ids).toEqual(expect.arrayContaining([allVisibleDocId, staffOnlyDocId]));
    });

    it("shows the customer every document on their own case", async () => {
      const res = await request(app.getHttpServer()).get(`/api/cases/${caseId}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      const ids = res.body.documents.map((d: { id: string }) => d.id);
      expect(ids).toEqual(expect.arrayContaining([allVisibleDocId, staffOnlyDocId]));
    });
  });

  describe('partner role isolation', () => {
    it("never leaks any case into a partner contact's case list", async () => {
      const res = await request(app.getHttpServer()).get('/api/cases').set('Authorization', `Bearer ${partnerToken}`).expect(200);
      expect(res.body).toEqual([]);
    });

    it('blocks a partner contact from the admin-only partner directory', async () => {
      await request(app.getHttpServer()).get('/api/partners').set('Authorization', `Bearer ${partnerToken}`).expect(403);
    });

    it('blocks a partner contact from case detail entirely', async () => {
      await request(app.getHttpServer()).get(`/api/cases/${caseId}`).set('Authorization', `Bearer ${partnerToken}`).expect(403);
    });
  });

  describe('privilege escalation via role-mismatched endpoints', () => {
    it('blocks a customer from the ops-only agents directory mutation', async () => {
      await request(app.getHttpServer())
        .post('/api/agents')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ fullName: 'Injected Agent' })
        .expect(403);
    });

    it('blocks a field agent from issuing a quote (staff-only action)', async () => {
      await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/quotes`)
        .set('Authorization', `Bearer ${ownAgentToken}`)
        .send({ amount: 1000 })
        .expect(403);
    });

    it("blocks a customer from another customer's beneficiary/property staff-read endpoint", async () => {
      await request(app.getHttpServer())
        .get(`/api/customers/${customerB.customer.id}/beneficiaries`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(403);
    });
  });
});
