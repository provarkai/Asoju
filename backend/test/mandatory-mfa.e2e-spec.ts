import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { DEFAULT_PASSWORD, createCustomer, createStaff, uniqueEmail, prisma } from './utils/fixtures';
import { generateTotpCode } from '../src/auth/totp';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Admin Console & Platform Admin Architecture v1.0 Section 4 "Admin
 * Roles" / UX/UI Specification v1.0 Section 42 "Security UX" —
 * "Privileged Admin accounts should require MFA." Real app, real
 * Postgres — every code exchanged here is a real generated TOTP code
 * against a real secret, not a stub.
 */
describe('Mandatory MFA for privileged roles', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('a fresh Admin without MFA gets no real session at all, just an enrollment token', async () => {
    const { email } = await createStaff('mmfa-admin', Role.ADMIN);
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);

    expect(res.body.mfaEnrollmentRequired).toBe(true);
    expect(res.body.enrollmentToken).toBeTruthy();
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
  });

  it('Finance and Compliance/Risk are also required to enroll; Case Manager is not', async () => {
    const finance = await createStaff('mmfa-finance', Role.FINANCE);
    const compliance = await createStaff('mmfa-compliance', Role.COMPLIANCE_RISK);
    const caseManager = await createStaff('mmfa-cm', Role.CASE_MANAGER);

    const financeRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: finance.email, password: DEFAULT_PASSWORD })
      .expect(200);
    expect(financeRes.body.mfaEnrollmentRequired).toBe(true);

    const complianceRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: compliance.email, password: DEFAULT_PASSWORD })
      .expect(200);
    expect(complianceRes.body.mfaEnrollmentRequired).toBe(true);

    const cmRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: caseManager.email, password: DEFAULT_PASSWORD })
      .expect(200);
    expect(cmRes.body.mfaEnrollmentRequired).toBeFalsy();
    expect(cmRes.body.accessToken).toBeTruthy();
  });

  it('a customer never needs to enroll', async () => {
    const { email } = await createCustomer('mmfa-customer');
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);
    expect(res.body.mfaEnrollmentRequired).toBeFalsy();
    expect(res.body.accessToken).toBeTruthy();
  });

  it('rejects a garbage enrollment token on both steps', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/mfa/enrollment-required/start')
      .send({ enrollmentToken: 'not-a-real-token' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/mfa/enrollment-required/confirm')
      .send({ enrollmentToken: 'not-a-real-token', code: '000000' })
      .expect(401);
  });

  it("rejects a normal mfa_pending token (a different account's normal MFA challenge) on the enrollment-required endpoints", async () => {
    // Build a separate, already-MFA-enrolled admin so we can obtain a real
    // mfa_pending token (the *other* purpose) and confirm it's rejected
    // here — the two token purposes must never be interchangeable.
    const passwordHash = await argon2.hash(DEFAULT_PASSWORD);
    const email = uniqueEmail('mmfa-existing');
    const user = await prisma.user.create({ data: { email, passwordHash, role: Role.ADMIN } });
    const secret = 'JBSWY3DPEHPK3PXP';
    await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: secret, mfaEnabled: true } });

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);
    expect(loginRes.body.mfaRequired).toBe(true);
    const { mfaToken } = loginRes.body;

    await request(app.getHttpServer())
      .post('/api/auth/mfa/enrollment-required/start')
      .send({ enrollmentToken: mfaToken })
      .expect(401);
  });

  it('rejects the wrong code at the confirm step, keeping the account without a session', async () => {
    const { email } = await createStaff('mmfa-wrongcode', Role.ADMIN);
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);
    const { enrollmentToken } = loginRes.body;

    await request(app.getHttpServer())
      .post('/api/auth/mfa/enrollment-required/start')
      .send({ enrollmentToken })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/mfa/enrollment-required/confirm')
      .send({ enrollmentToken, code: '000000' })
      .expect(401);
  });

  it(
    'completes the full enroll -> confirm flow with a real TOTP code, returns a working session, ' +
      'and a subsequent login goes through the normal MFA challenge instead of enrollment again',
    async () => {
      const { email } = await createStaff('mmfa-flow', Role.ADMIN);
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: DEFAULT_PASSWORD })
        .expect(200);
      const { enrollmentToken } = loginRes.body;

      const startRes = await request(app.getHttpServer())
        .post('/api/auth/mfa/enrollment-required/start')
        .send({ enrollmentToken })
        .expect(200);
      expect(startRes.body.secret).toBeTruthy();
      expect(startRes.body.otpAuthUrl).toContain('otpauth://');

      const code = generateTotpCode(startRes.body.secret);
      const confirmRes = await request(app.getHttpServer())
        .post('/api/auth/mfa/enrollment-required/confirm')
        .send({ enrollmentToken, code })
        .expect(200);
      expect(confirmRes.body.accessToken).toBeTruthy();
      expect(confirmRes.body.user.email).toBe(email);

      // The returned token is a real, working session.
      const meRes = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${confirmRes.body.accessToken}`)
        .expect(200);
      expect(meRes.body.mfaEnabled).toBe(true);

      // Logging in again now hits the normal MFA challenge, not enrollment.
      const secondLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: DEFAULT_PASSWORD })
        .expect(200);
      expect(secondLogin.body.mfaEnrollmentRequired).toBeFalsy();
      expect(secondLogin.body.mfaRequired).toBe(true);
      expect(secondLogin.body.mfaToken).toBeTruthy();
    },
  );
});
