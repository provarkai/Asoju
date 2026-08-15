import { randomBytes } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp } from './utils/bootstrap';
import { createCustomer, createStaff, createAgent, login, prisma, uniqueEmail } from './utils/fixtures';
import { Role } from '@prisma/client';

function uniquePhone(): string {
  return `+234${randomBytes(5).toString('hex')}`;
}

/**
 * Platform Expansion PRD §4.4 "Two-Way Beneficiary Relay" — upgrades the
 * read-only beneficiary portal (beneficiary-portal.e2e-spec.ts) to a
 * moderated Beneficiary <-> Case Manager channel. Real app, real
 * Postgres.
 */
describe('Beneficiary relay', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let caseManager: Awaited<ReturnType<typeof createStaff>>;
  let agent: Awaited<ReturnType<typeof createAgent>>;

  let customerToken: string;
  let adminToken: string;
  let caseManagerToken: string;
  let agentToken: string;

  beforeAll(async () => {
    app = await createTestApp();

    [customer, admin, caseManager, agent] = await Promise.all([
      createCustomer('relay'),
      createStaff('relay-admin', Role.ADMIN),
      createStaff('relay-cm', Role.CASE_MANAGER),
      createAgent('relay-agent'),
    ]);
    [customerToken, adminToken, caseManagerToken, agentToken] = await Promise.all([
      login(app, customer.email),
      login(app, admin.email),
      login(app, caseManager.email),
      login(app, agent.email),
    ]);
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

  /** Beneficiary with a claimed portal login, named on a fresh case. The
   * field-agent-is-blocked test below doesn't need a real assignment —
   * RolesGuard rejects the FIELD_AGENT role before CaseAccessGuard ever
   * gets to check one. */
  async function createCaseWithBeneficiary(): Promise<{ caseId: string; beneficiaryToken: string }> {
    const benRes = await request(app.getHttpServer())
      .post('/api/me/beneficiaries')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ fullName: 'Relay Beneficiary', relationship: 'Mother', phone: uniquePhone() })
      .expect(201);
    const beneficiaryId = benRes.body.id;

    const inviteRes = await request(app.getHttpServer())
      .post(`/api/me/beneficiaries/${beneficiaryId}/invite`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);
    const token = new URL(inviteRes.body.devInviteLink).searchParams.get('token')!;
    const acceptRes = await request(app.getHttpServer())
      .post('/api/auth/beneficiary-invite/accept')
      .send({ token, email: uniqueEmail('relay-ben'), password: 'Passw0rd!23' })
      .expect(200);
    const beneficiaryToken: string = acceptRes.body.accessToken;

    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Check on my mother\'s house', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD', beneficiaryId })
      .expect(201);
    const caseId = caseRes.body.id;

    return { caseId, beneficiaryToken };
  }

  it('lets a beneficiary send a message and staff reply, both visible in the thread', async () => {
    const { caseId, beneficiaryToken } = await createCaseWithBeneficiary();

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/beneficiary-relay`)
      .set('Authorization', `Bearer ${beneficiaryToken}`)
      .send({ body: 'The gate was locked when the agent arrived' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/beneficiary-relay`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'Thanks, we are looking into it' })
      .expect(201);

    const thread = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/beneficiary-relay`)
      .set('Authorization', `Bearer ${beneficiaryToken}`)
      .expect(200);
    expect(thread.body).toHaveLength(2);
    expect(thread.body[0].fromBeneficiary).toBe(true);
    expect(thread.body[0].type).toBe('MESSAGE');
    expect(thread.body[1].fromBeneficiary).toBe(false);
  });

  it('lets a beneficiary raise an OBJECTION, which staff can acknowledge exactly once', async () => {
    const { caseId, beneficiaryToken } = await createCaseWithBeneficiary();

    const raised = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/beneficiary-relay`)
      .set('Authorization', `Bearer ${beneficiaryToken}`)
      .send({ body: 'This is not what we agreed on', type: 'OBJECTION' })
      .expect(201);
    expect(raised.body.type).toBe('OBJECTION');
    expect(raised.body.acknowledgedAt).toBeNull();

    const acknowledged = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/beneficiary-relay/${raised.body.id}/acknowledge`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(acknowledged.body.acknowledgedAt).toBeTruthy();

    // Idempotent — acknowledging again doesn't error or move the timestamp.
    const again = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/beneficiary-relay/${raised.body.id}/acknowledge`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(again.body.acknowledgedAt).toBe(acknowledged.body.acknowledgedAt);
  });

  it('rejects acknowledging a plain MESSAGE (only objections can be acknowledged)', async () => {
    const { caseId, beneficiaryToken } = await createCaseWithBeneficiary();
    const msg = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/beneficiary-relay`)
      .set('Authorization', `Bearer ${beneficiaryToken}`)
      .send({ body: 'Just checking in' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/beneficiary-relay/${msg.body.id}/acknowledge`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it("blocks a beneficiary from acknowledging their own objection", async () => {
    const { caseId, beneficiaryToken } = await createCaseWithBeneficiary();
    const raised = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/beneficiary-relay`)
      .set('Authorization', `Bearer ${beneficiaryToken}`)
      .send({ body: 'Objection', type: 'OBJECTION' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/beneficiary-relay/${raised.body.id}/acknowledge`)
      .set('Authorization', `Bearer ${beneficiaryToken}`)
      .expect(403);
  });

  it('lets an explicit CASE_MANAGER collaborator read and reply to the thread', async () => {
    const { caseId, beneficiaryToken } = await createCaseWithBeneficiary();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/collaborators`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: caseManager.user.id, role: 'CASE_MANAGER' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/beneficiary-relay`)
      .set('Authorization', `Bearer ${beneficiaryToken}`)
      .send({ body: 'Hello case manager' })
      .expect(201);

    const thread = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/beneficiary-relay`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .expect(200);
    expect(thread.body).toHaveLength(1);
  });

  it('never lets a field agent see or post to the relay — the PII/objection channel is Beneficiary <-> Case Manager only', async () => {
    const { caseId } = await createCaseWithBeneficiary();

    await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/beneficiary-relay`)
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/beneficiary-relay`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ body: 'trying anyway' })
      .expect(403);
  });

  it('blocks the customer themselves — this channel is Beneficiary <-> Case Manager, not Customer <-> Case Manager', async () => {
    const { caseId } = await createCaseWithBeneficiary();
    await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/beneficiary-relay`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
  });

  it("blocks a different beneficiary from reading or posting to another beneficiary's case", async () => {
    const { caseId } = await createCaseWithBeneficiary();
    const { beneficiaryToken: otherBeneficiaryToken } = await createCaseWithBeneficiary();

    await request(app.getHttpServer())
      .get(`/api/cases/${caseId}/beneficiary-relay`)
      .set('Authorization', `Bearer ${otherBeneficiaryToken}`)
      .expect(403);
  });

  it('records audit events for both a beneficiary message and a staff acknowledgement', async () => {
    const { caseId, beneficiaryToken } = await createCaseWithBeneficiary();
    const raised = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/beneficiary-relay`)
      .set('Authorization', `Bearer ${beneficiaryToken}`)
      .send({ body: 'Audit me', type: 'OBJECTION' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/beneficiary-relay/${raised.body.id}/acknowledge`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const events = await prisma.auditEvent.findMany({
      where: { caseId, action: { in: ['beneficiary_relay.message_from_beneficiary', 'beneficiary_relay.objection_acknowledged'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.action)).toEqual(['beneficiary_relay.message_from_beneficiary', 'beneficiary_relay.objection_acknowledged']);
  });
});
