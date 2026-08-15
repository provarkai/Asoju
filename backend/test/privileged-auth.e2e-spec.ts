import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { DEFAULT_PASSWORD, createCustomer, prisma } from './utils/fixtures';
import { generateTotpCode } from '../src/auth/totp';

/**
 * P0-06 "Privileged authentication hardening" (independent readiness
 * review) — MFA enrollment/challenge, password reset, and session
 * revocation, driven through the real app end-to-end.
 */
describe('Privileged authentication', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();

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

  describe('MFA enroll -> confirm -> login challenge', () => {
    it('requires the TOTP code on the next login once MFA is confirmed, and rejects a wrong one', async () => {
      const { email } = await createCustomer('mfa');
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: DEFAULT_PASSWORD })
        .expect(200);
      const accessToken = loginRes.body.accessToken;
      expect(loginRes.body.mfaRequired).toBe(false);

      const enrollRes = await request(app.getHttpServer())
        .post('/api/auth/mfa/enroll')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);
      const { secret } = enrollRes.body;
      expect(enrollRes.body.otpAuthUrl).toContain('otpauth://totp/');

      // Wrong code doesn't confirm enrollment.
      await request(app.getHttpServer())
        .post('/api/auth/mfa/confirm')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: '000000' })
        .expect(400);

      await request(app.getHttpServer())
        .post('/api/auth/mfa/confirm')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: generateTotpCode(secret) })
        .expect(200);

      // Next login stops at the MFA challenge — no real tokens yet.
      const secondLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: DEFAULT_PASSWORD })
        .expect(200);
      expect(secondLogin.body.mfaRequired).toBe(true);
      expect(secondLogin.body.accessToken).toBeUndefined();
      const { mfaToken } = secondLogin.body;

      // A wrong code doesn't complete the login.
      await request(app.getHttpServer())
        .post('/api/auth/mfa/verify')
        .send({ mfaToken, code: '000000' })
        .expect(401);

      // The mfaToken itself is not a usable access token — it's signed
      // with a different secret, so JwtStrategy must reject it outright.
      await request(app.getHttpServer())
        .get('/api/cases')
        .set('Authorization', `Bearer ${mfaToken}`)
        .expect(401);

      // The correct code completes the login.
      const verified = await request(app.getHttpServer())
        .post('/api/auth/mfa/verify')
        .send({ mfaToken, code: generateTotpCode(secret) })
        .expect(200);
      expect(verified.body.accessToken).toBeDefined();

      // That real access token works normally.
      await request(app.getHttpServer())
        .get('/api/cases')
        .set('Authorization', `Bearer ${verified.body.accessToken}`)
        .expect(200);
    });

    it('lets a user disable MFA with their password, and login stops challenging them', async () => {
      const { email } = await createCustomer('mfa-disable');
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: DEFAULT_PASSWORD })
        .expect(200);
      const accessToken = loginRes.body.accessToken;

      const enrollRes = await request(app.getHttpServer())
        .post('/api/auth/mfa/enroll')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/auth/mfa/confirm')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: generateTotpCode(enrollRes.body.secret) })
        .expect(200);

      // Wrong password can't disable it.
      await request(app.getHttpServer())
        .post('/api/auth/mfa/disable')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ password: 'wrong-password' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/auth/mfa/disable')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ password: DEFAULT_PASSWORD })
        .expect(200);

      const loginAgain = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: DEFAULT_PASSWORD })
        .expect(200);
      expect(loginAgain.body.mfaRequired).toBe(false);
      expect(loginAgain.body.accessToken).toBeDefined();
    });
  });

  describe('password reset', () => {
    it('never reveals whether an email exists', async () => {
      const knownRes = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: 'definitely-not-a-real-user@e2e.test' })
        .expect(200);
      expect(knownRes.body.message).toBe('If that email exists, a reset link has been sent.');
      expect(knownRes.body.devToken).toBeUndefined();
    });

    it('resets the password, revokes existing sessions, and rejects a reused token', async () => {
      const { email } = await createCustomer('reset');
      const originalLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: DEFAULT_PASSWORD })
        .expect(200);
      const oldRefreshToken = originalLogin.body.refreshToken;

      const forgotRes = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email })
        .expect(200);
      const { devToken } = forgotRes.body;
      expect(devToken).toBeDefined();

      const newPassword = 'BrandNewPassw0rd!';
      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: devToken, newPassword })
        .expect(200);

      // Old password no longer works.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: DEFAULT_PASSWORD })
        .expect(401);

      // New password does.
      await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: newPassword }).expect(200);

      // The reset also revoked every pre-existing refresh token.
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: oldRefreshToken })
        .expect(401);

      // The reset token itself is single-use.
      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: devToken, newPassword: 'AnotherOne123!' })
        .expect(401);
    });
  });

  describe('session revocation', () => {
    it('logout-all revokes every refresh token, not just the current one', async () => {
      const { email } = await createCustomer('logout-all');
      const sessionA = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: DEFAULT_PASSWORD })
        .expect(200);
      const sessionB = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: DEFAULT_PASSWORD })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/logout-all')
        .set('Authorization', `Bearer ${sessionA.body.accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: sessionA.body.refreshToken })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: sessionB.body.refreshToken })
        .expect(401);
    });
  });
});
