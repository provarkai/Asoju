import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 2 — the Escalation entity.
 * Real app, real Postgres, no mocks. Covers: creation with a required
 * customer-safe message, the staff triage queue and detail view, the
 * curated customer-facing view (never internalReason/handoffSummary/
 * assignedToId), assign/resolve/cancel, and access control.
 */
describe('Escalations', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let otherCustomer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let caseManager: Awaited<ReturnType<typeof createStaff>>;
  let agent: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let otherCustomerToken: string;
  let adminToken: string;
  let caseManagerToken: string;
  let agentToken: string;

  async function createCase(): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Escalation test case', location: 'Lagos, Nigeria', channel: 'web' })
      .expect(201);

    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        serviceType: 'PROPERTY_INSPECTION',
        description: 'Escalation case',
        location: 'Lagos, Nigeria',
        priority: 'STANDARD',
        tier: 'CONCIERGE',
      })
      .expect(201);

    return caseRes.body.id;
  }

  beforeAll(async () => {
    app = await createTestApp();

    [customer, otherCustomer, admin, caseManager, agent] = await Promise.all([
      createCustomer('escalation'),
      createCustomer('escalation-other'),
      createStaff('escalation-admin', Role.ADMIN),
      createStaff('escalation-cm', Role.CASE_MANAGER),
      createStaff('escalation-agent', Role.FIELD_AGENT),
    ]);
    [customerToken, otherCustomerToken, adminToken, caseManagerToken, agentToken] = await Promise.all([
      login(app, customer.email),
      login(app, otherCustomer.email),
      login(app, admin.email),
      login(app, caseManager.email),
      login(app, agent.email),
    ]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('POST /cases/:caseId/escalations', () => {
    it('creates an escalation with REQUIRED status and records an audit entry', async () => {
      const caseId = await createCase();

      const res = await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/escalations`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reasonCategory: 'MISSING_INFORMATION',
          customerMessage: 'We need a bit more detail before proceeding.',
          internalReason: 'Customer address is ambiguous, cannot confirm zone.',
          handoffSummary: { attemptedZoneLookup: true },
        })
        .expect(201);

      expect(res.body.status).toBe('REQUIRED');
      expect(res.body.caseId).toBe(caseId);
      expect(res.body.customerMessage).toBe('We need a bit more detail before proceeding.');

      const auditRes = await request(app.getHttpServer())
        .get('/api/admin/audit-events')
        .query({ caseId, action: 'escalation.created' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(auditRes.body.events.some((entry: any) => entry.action === 'escalation.created')).toBe(true);
    });

    it('rejects an escalation with no customerMessage', async () => {
      const caseId = await createCase();
      await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/escalations`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reasonCategory: 'MISSING_INFORMATION', customerMessage: '' })
        .expect(400);
    });

    it('blocks a customer and a field agent from creating an escalation', async () => {
      const caseId = await createCase();
      await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/escalations`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ reasonCategory: 'MISSING_INFORMATION', customerMessage: 'x' })
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/escalations`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ reasonCategory: 'MISSING_INFORMATION', customerMessage: 'x' })
        .expect(403);
    });

    it('blocks a Case Manager not explicitly added to the case (CaseAccessGuard)', async () => {
      const caseId = await createCase();
      await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/escalations`)
        .set('Authorization', `Bearer ${caseManagerToken}`)
        .send({ reasonCategory: 'MISSING_INFORMATION', customerMessage: 'x' })
        .expect(403);
    });
  });

  describe('GET /cases/:caseId/escalations — curated customer view', () => {
    it('gives the case-owning customer only the customer-safe fields', async () => {
      const caseId = await createCase();
      await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/escalations`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reasonCategory: 'PRICING_UNAVAILABLE',
          customerMessage: 'Reviewing your case, will confirm pricing shortly.',
          internalReason: 'No active price book for this zone.',
          handoffSummary: { zone: 'OTHER' },
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/cases/${caseId}/escalations`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      const entry = res.body[0];
      expect(entry.customerMessage).toBe('Reviewing your case, will confirm pricing shortly.');
      expect(entry.internalReason).toBeUndefined();
      expect(entry.handoffSummary).toBeUndefined();
      expect(entry.assignedToId).toBeUndefined();
    });

    it('gives staff the full record including internalReason and handoffSummary', async () => {
      const caseId = await createCase();
      await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/escalations`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reasonCategory: 'POLICY_RISK',
          customerMessage: 'Under review.',
          internalReason: 'Possible sanctions-list match, compliance review required.',
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/cases/${caseId}/escalations`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body[0].internalReason).toBe('Possible sanctions-list match, compliance review required.');
    });

    it('blocks a customer who does not own the case', async () => {
      const caseId = await createCase();
      await request(app.getHttpServer())
        .get(`/api/cases/${caseId}/escalations`)
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .expect(403);
    });
  });

  describe('staff triage queue and lifecycle', () => {
    it('lists escalations in the staff queue, filterable by status, and blocks non-staff', async () => {
      const caseId = await createCase();
      await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/escalations`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reasonCategory: 'TECHNICAL_FAILURE', customerMessage: 'Investigating an issue on our end.' })
        .expect(201);

      const queue = await request(app.getHttpServer())
        .get('/api/escalations?status=REQUIRED')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(queue.body.some((e: any) => e.caseId === caseId)).toBe(true);
      expect(queue.body.every((e: any) => e.status === 'REQUIRED')).toBe(true);

      await request(app.getHttpServer()).get('/api/escalations').set('Authorization', `Bearer ${customerToken}`).expect(403);
    });

    it('assigns only to operations staff, then resolves, and rejects a double-resolve', async () => {
      const caseId = await createCase();
      const createRes = await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/escalations`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reasonCategory: 'NON_STANDARD_SCOPE', customerMessage: 'Reviewing scope with a specialist.' })
        .expect(201);
      const escalationId = createRes.body.id;

      // Assigning to a customer (not ops staff) is rejected.
      await request(app.getHttpServer())
        .post(`/api/escalations/${escalationId}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ assignedToId: customer.user.id })
        .expect(400);

      const assignRes = await request(app.getHttpServer())
        .post(`/api/escalations/${escalationId}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ assignedToId: caseManager.user.id })
        .expect(201);
      expect(assignRes.body.status).toBe('REVIEWING');
      expect(assignRes.body.assignedToId).toBe(caseManager.user.id);

      const resolveRes = await request(app.getHttpServer())
        .post(`/api/escalations/${escalationId}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ resolutionNotes: 'Specialist confirmed scope is standard after all.' })
        .expect(201);
      expect(resolveRes.body.status).toBe('RESOLVED');
      expect(resolveRes.body.resolvedAt).toBeTruthy();

      await request(app.getHttpServer())
        .post(`/api/escalations/${escalationId}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ resolutionNotes: 'Trying again' })
        .expect(400);
    });

    it('cancels an escalation', async () => {
      const caseId = await createCase();
      const createRes = await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/escalations`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reasonCategory: 'MANUAL', customerMessage: 'One moment please.' })
        .expect(201);
      const escalationId = createRes.body.id;

      const cancelRes = await request(app.getHttpServer())
        .post(`/api/escalations/${escalationId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ resolutionNotes: 'Raised in error.' })
        .expect(201);
      expect(cancelRes.body.status).toBe('CANCELLED');
    });

    it('returns 404 for an unknown escalation id on the staff detail endpoint', async () => {
      await request(app.getHttpServer())
        .get('/api/escalations/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });
});
