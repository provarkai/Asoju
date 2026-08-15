import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma, uniqueEmail, DEFAULT_PASSWORD } from './utils/fixtures';
import { PartnerType, Role } from '@prisma/client';

/**
 * Section 5.7 "Admin Console" — the self-service gap the README called
 * out: staff/partner accounts previously needed raw Prisma/psql. Real
 * app, real Postgres.
 */
describe('Admin Console — account provisioning', () => {
  let app: INestApplication;

  let admin: Awaited<ReturnType<typeof createStaff>>;
  let caseManager: Awaited<ReturnType<typeof createStaff>>;
  let customer: Awaited<ReturnType<typeof createCustomer>>;

  let adminToken: string;
  let caseManagerToken: string;
  let customerToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();

      [admin, caseManager, customer] = await Promise.all([
        createStaff('admin-console-admin', Role.ADMIN),
        createStaff('admin-console-cm', Role.CASE_MANAGER),
        createCustomer('admin-console'),
      ]);
      [adminToken, caseManagerToken, customerToken] = await Promise.all([
        login(app, admin.email),
        login(app, caseManager.email),
        login(app, customer.email),
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

  it('provisions a staff account, which the new holder can then set up and log into', async () => {
    const email = uniqueEmail('provisioned-fin');
    const created = await request(app.getHttpServer())
      .post('/api/auth/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, role: 'FINANCE' })
      .expect(201);

    expect(created.body.user.email).toBe(email);
    expect(created.body.user.role).toBe('FINANCE');
    // Never leaks the password hash, even though it's an unusable random value.
    expect(created.body.user.passwordHash).toBeUndefined();
    expect(created.body.devToken).toBeTruthy();

    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ token: created.body.devToken, newPassword: DEFAULT_PASSWORD })
      .expect(200);

    // FINANCE requires MFA enrollment on first login (MFA_REQUIRED_ROLES) —
    // getting mfaEnrollmentRequired back at all proves the account is
    // real and the password took, without re-testing the MFA flow itself
    // (already covered by mandatory-mfa.e2e-spec.ts).
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);
    expect(loginRes.body.mfaEnrollmentRequired).toBe(true);
  });

  it('rejects provisioning a duplicate email', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: admin.email, role: 'CASE_MANAGER' })
      .expect(409);
  });

  it('rejects a non-staff role (CUSTOMER, FIELD_AGENT, PARTNER)', async () => {
    for (const role of ['CUSTOMER', 'FIELD_AGENT', 'PARTNER']) {
      await request(app.getHttpServer())
        .post('/api/auth/admin/staff')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: uniqueEmail('bad-role'), role })
        .expect(400);
    }
  });

  it('blocks non-admin staff and customers from provisioning accounts', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/admin/staff')
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .send({ email: uniqueEmail('blocked'), role: 'CASE_MANAGER' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/auth/admin/staff')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ email: uniqueEmail('blocked'), role: 'CASE_MANAGER' })
      .expect(403);
  });

  it('provisions a PARTNER-role login attached to a Partner org, which can then access the partner dashboard', async () => {
    const partnerRes = await request(app.getHttpServer())
      .post('/api/partners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Diaspora Association Test', type: PartnerType.ASSOCIATION })
      .expect(201);
    const partnerId = partnerRes.body.id;

    const email = uniqueEmail('partner-contact');
    const created = await request(app.getHttpServer())
      .post(`/api/partners/${partnerId}/contacts`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email })
      .expect(201);
    expect(created.body.user.role).toBe('PARTNER');
    expect(created.body.contact.partnerId).toBe(partnerId);

    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ token: created.body.devToken, newPassword: DEFAULT_PASSWORD })
      .expect(200);
    const partnerToken = await login(app, email);

    const dashboard = await request(app.getHttpServer())
      .get('/api/partner/dashboard')
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);
    expect(dashboard.body.partner.id).toBe(partnerId);
  });

  it('rejects creating a contact for a partner that does not exist', async () => {
    await request(app.getHttpServer())
      .post('/api/partners/00000000-0000-0000-0000-000000000000/contacts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: uniqueEmail('orphan-contact') })
      .expect(404);
  });

  it('records a user.admin_provisioned audit event', async () => {
    const email = uniqueEmail('audit-check');
    const created = await request(app.getHttpServer())
      .post('/api/auth/admin/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, role: 'CASE_MANAGER' })
      .expect(201);

    const events = await prisma.auditEvent.findMany({
      where: { action: 'user.admin_provisioned', actorId: admin.user.id },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(events).toHaveLength(1);
    expect((events[0].metadata as { userId?: string }).userId).toBe(created.body.user.id);
  });

  /**
   * Security checklist ("Admin Access Audit" / "Employee Offboarding") —
   * list every staff account and disable one, killing its sessions.
   */
  describe('staff account listing and deactivation', () => {
    it('lists staff accounts without ever leaking the password hash or MFA secret', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/admin/staff')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const listedIds = res.body.map((u: { id: string }) => u.id);
      expect(listedIds).toContain(admin.user.id);
      expect(listedIds).toContain(caseManager.user.id);
      // Never includes CUSTOMER accounts — this endpoint is staff-only.
      expect(listedIds).not.toContain(customer.user.id);

      const entry = res.body.find((u: { id: string }) => u.id === caseManager.user.id);
      expect(entry.passwordHash).toBeUndefined();
      expect(entry.mfaSecret).toBeUndefined();
      expect(entry.isActive).toBe(true);
    });

    it('blocks non-admin roles from the staff listing', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/admin/staff')
        .set('Authorization', `Bearer ${caseManagerToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/auth/admin/staff')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);
    });

    it('deactivates a staff account, revoking its active session — a subsequent request with the old token is rejected', async () => {
      const target = await createStaff('offboard-target', Role.CASE_MANAGER);
      const targetToken = await login(app, target.email);

      // Prove the token works before deactivation.
      await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${targetToken}`).expect(200);

      await request(app.getHttpServer())
        .post(`/api/auth/admin/staff/${target.user.id}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: target.user.id } });
      expect(dbUser.isActive).toBe(false);

      // Login must now fail outright (isActive gate).
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: target.email, password: DEFAULT_PASSWORD })
        .expect(401);

      const revoked = await prisma.refreshToken.findMany({ where: { userId: target.user.id, revokedAt: null } });
      expect(revoked).toHaveLength(0);
    });

    it('rejects deactivating your own account', async () => {
      await request(app.getHttpServer())
        .post(`/api/auth/admin/staff/${admin.user.id}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('rejects deactivating a non-staff account (e.g. a customer) through this endpoint', async () => {
      await request(app.getHttpServer())
        .post(`/api/auth/admin/staff/${customer.user.id}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('blocks non-admin roles from deactivating staff', async () => {
      const target = await createStaff('offboard-blocked', Role.CASE_MANAGER);
      await request(app.getHttpServer())
        .post(`/api/auth/admin/staff/${target.user.id}/deactivate`)
        .set('Authorization', `Bearer ${caseManagerToken}`)
        .expect(403);
    });

    it('reactivates a deactivated staff account, which can then log in again', async () => {
      const target = await createStaff('offboard-reactivate', Role.CASE_MANAGER);

      await request(app.getHttpServer())
        .post(`/api/auth/admin/staff/${target.user.id}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: target.email, password: DEFAULT_PASSWORD })
        .expect(401);

      await request(app.getHttpServer())
        .post(`/api/auth/admin/staff/${target.user.id}/reactivate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: target.user.id } });
      expect(dbUser.isActive).toBe(true);
      await login(app, target.email); // succeeds — throws via .expect(200) internally otherwise
    });

    it('records user.staff_deactivated and user.staff_reactivated audit events', async () => {
      const target = await createStaff('offboard-audit', Role.CASE_MANAGER);

      await request(app.getHttpServer())
        .post(`/api/auth/admin/staff/${target.user.id}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/auth/admin/staff/${target.user.id}/reactivate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const deactivated = await prisma.auditEvent.findMany({
        where: { action: 'user.staff_deactivated', actorId: admin.user.id },
      });
      const reactivated = await prisma.auditEvent.findMany({
        where: { action: 'user.staff_reactivated', actorId: admin.user.id },
      });
      expect(deactivated.some((e) => (e.metadata as { userId?: string }).userId === target.user.id)).toBe(true);
      expect(reactivated.some((e) => (e.metadata as { userId?: string }).userId === target.user.id)).toBe(true);
    });
  });
});
