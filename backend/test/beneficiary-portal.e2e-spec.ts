import { randomBytes } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma, uniqueEmail } from './utils/fixtures';
import { Role } from '@prisma/client';

// User.phone is globally unique (schema.prisma) and acceptBeneficiaryInvite
// copies Beneficiary.phone onto the new User — so, same as uniqueEmail,
// every fixture phone number needs to be unique per test run or a re-run
// against a non-empty asoju_test collides with a leftover User row.
function uniquePhone(): string {
  return `+234${randomBytes(5).toString('hex')}`;
}

/**
 * "Who is a Beneficiary" (portal access) — the person a diaspora Customer
 * names on a case gets their own limited, read-only login instead of
 * being invisible to the system. Real app, real Postgres.
 */
describe('Beneficiary portal access', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let customerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();

      [customer, admin] = await Promise.all([createCustomer('benport'), createStaff('benport-admin', Role.ADMIN)]);
      [customerToken, adminToken] = await Promise.all([login(app, customer.email), login(app, admin.email)]);

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

  async function createBeneficiary(fullName: string, phone?: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/me/beneficiaries')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ fullName, relationship: 'Mother', phone })
      .expect(201);
    return res.body.id;
  }

  async function createCaseForBeneficiary(beneficiaryId: string): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Check on my mother\'s house', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        serviceType: 'PROPERTY_INSPECTION',
        description: 'Inspect the house',
        location: 'Lagos',
        priority: 'STANDARD',
        beneficiaryId,
      })
      .expect(201);
    return caseRes.body.id;
  }

  async function inviteAndAccept(beneficiaryId: string, email: string): Promise<string> {
    const inviteRes = await request(app.getHttpServer())
      .post(`/api/me/beneficiaries/${beneficiaryId}/invite`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);
    const link: string = inviteRes.body.devInviteLink;
    const token = new URL(link).searchParams.get('token')!;

    const acceptRes = await request(app.getHttpServer())
      .post('/api/auth/beneficiary-invite/accept')
      .send({ token, email, password: 'Passw0rd!23' })
      .expect(200);
    expect(acceptRes.body.user.role).toBe('BENEFICIARY');
    return acceptRes.body.accessToken;
  }

  it('lets a customer invite a beneficiary and the beneficiary claim a real login', async () => {
    const beneficiaryId = await createBeneficiary('Grace Adeyemi', uniquePhone());
    const token = await inviteAndAccept(beneficiaryId, uniqueEmail('grace-claim'));

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.role).toBe('BENEFICIARY');

    const beneficiary = await prisma.beneficiary.findUniqueOrThrow({ where: { id: beneficiaryId } });
    expect(beneficiary.userId).toBeTruthy();
  });

  it('rejects inviting a beneficiary that already has a portal account', async () => {
    const beneficiaryId = await createBeneficiary('Already Invited', uniquePhone());
    await inviteAndAccept(beneficiaryId, uniqueEmail('already-invited'));

    await request(app.getHttpServer())
      .post(`/api/me/beneficiaries/${beneficiaryId}/invite`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(400);
  });

  it('rejects a garbage or expired invite token', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/beneficiary-invite/accept')
      .send({ token: 'not-a-real-token', email: uniqueEmail('nobody'), password: 'Passw0rd!23' })
      .expect(401);

    const beneficiaryId = await createBeneficiary('Expired Invite', uniquePhone());
    const inviteRes = await request(app.getHttpServer())
      .post(`/api/me/beneficiaries/${beneficiaryId}/invite`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);
    const link: string = inviteRes.body.devInviteLink;
    const token = new URL(link).searchParams.get('token')!;

    await prisma.beneficiaryInvite.updateMany({
      where: { beneficiaryId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await request(app.getHttpServer())
      .post('/api/auth/beneficiary-invite/accept')
      .send({ token, email: uniqueEmail('expired-claim'), password: 'Passw0rd!23' })
      .expect(401);
  });

  it('rejects reusing an already-claimed invite token', async () => {
    const beneficiaryId = await createBeneficiary('Reuse Attempt', uniquePhone());
    const inviteRes = await request(app.getHttpServer())
      .post(`/api/me/beneficiaries/${beneficiaryId}/invite`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);
    const link: string = inviteRes.body.devInviteLink;
    const token = new URL(link).searchParams.get('token')!;

    await request(app.getHttpServer())
      .post('/api/auth/beneficiary-invite/accept')
      .send({ token, email: uniqueEmail('reuse-first'), password: 'Passw0rd!23' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/beneficiary-invite/accept')
      .send({ token, email: uniqueEmail('reuse-second'), password: 'Passw0rd!23' })
      .expect(401);
  });

  it('shows the beneficiary a curated, case-scoped, read-only view — no financial data', async () => {
    const beneficiaryId = await createBeneficiary('Curated View Mother', uniquePhone());
    const caseId = await createCaseForBeneficiary(beneficiaryId);
    const token = await inviteAndAccept(beneficiaryId, uniqueEmail('curated-view'));

    const list = await request(app.getHttpServer())
      .get('/api/cases')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(caseId);

    const detail = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail.body.caseNumber).toBeTruthy();
    expect(detail.body.status).toBeTruthy();
    expect(detail.body.statusHistory).toBeDefined();
    expect(detail.body.evidence).toBeDefined();
    expect(detail.body.reports).toBeDefined();
    // Never present for a beneficiary, regardless of what's on the case.
    expect(detail.body.quotes).toBeUndefined();
    expect(detail.body.invoices).toBeUndefined();
    expect(detail.body.approvals).toBeUndefined();
    expect(detail.body.collaborators).toBeUndefined();
    expect(detail.body.riskFlags).toBeUndefined();
    expect(detail.body.incidents).toBeUndefined();
    expect(detail.body.owner).toBeUndefined();
    expect(detail.body.customer).toBeUndefined();
  });

  it('blocks a beneficiary from a case that does not name them', async () => {
    const namedBeneficiaryId = await createBeneficiary('Named On Case', uniquePhone());
    const caseId = await createCaseForBeneficiary(namedBeneficiaryId);

    const unrelatedBeneficiaryId = await createBeneficiary('Not Named', uniquePhone());
    const unrelatedToken = await inviteAndAccept(unrelatedBeneficiaryId, uniqueEmail('unrelated-beneficiary'));

    await request(app.getHttpServer())
      .get(`/api/cases/${caseId}`)
      .set('Authorization', `Bearer ${unrelatedToken}`)
      .expect(403);

    const list = await request(app.getHttpServer())
      .get('/api/cases')
      .set('Authorization', `Bearer ${unrelatedToken}`)
      .expect(200);
    expect(list.body).toHaveLength(0);
  });

  it('audits the invite and account-creation events', async () => {
    const beneficiaryId = await createBeneficiary('Audited Beneficiary', uniquePhone());
    await inviteAndAccept(beneficiaryId, uniqueEmail('audited-beneficiary'));

    const events = await prisma.auditEvent.findMany({
      where: { action: { in: ['beneficiary.invited', 'beneficiary.account_created'] } },
    });
    const actions = events.map((e) => e.action);
    expect(actions).toContain('beneficiary.invited');
    expect(actions).toContain('beneficiary.account_created');
  });
});
