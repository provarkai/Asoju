import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomBytes } from 'crypto';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { DEFAULT_PASSWORD, createCustomer, prisma } from './utils/fixtures';

/**
 * POST /auth/register, end-to-end, including the referral/partner-code
 * gap this spec was added to close: a mistyped or expired code must never
 * block signup (Section 12 P1 "referral system" — growth feature, not a
 * gate), but the caller previously had no way to tell whether their code
 * was actually recognized at all. `referralCodeApplied`/
 * `partnerCodeApplied` on the response now make that observable without
 * changing the "never blocks signup" behavior.
 */
describe('Registration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();
    });
  });

  beforeEach(async () => {
    app = await ensureHealthyApp(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function uniqueRegisterEmail(): string {
    return `register-${randomBytes(4).toString('hex')}@e2e.test`;
  }

  it('creates a real account and issues a working session with no codes supplied', async () => {
    const email = uniqueRegisterEmail();
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ fullName: 'New Customer', email, password: DEFAULT_PASSWORD, countryOfResidence: 'United Kingdom' })
      .expect(201);

    expect(res.body.user.email).toBe(email);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.referralCodeApplied).toBeUndefined();
    expect(res.body.partnerCodeApplied).toBeUndefined();

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
  });

  it('rejects a duplicate email', async () => {
    const { email } = await createCustomer('dup');
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ fullName: 'Duplicate', email, password: DEFAULT_PASSWORD, countryOfResidence: 'United Kingdom' })
      .expect(409);
  });

  describe('referral code', () => {
    it('applies a valid referral code and reports it as applied', async () => {
      const { customer } = await createCustomer('referrer');
      const email = uniqueRegisterEmail();

      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          fullName: 'Referred Customer',
          email,
          password: DEFAULT_PASSWORD,
          countryOfResidence: 'United Kingdom',
          referralCode: customer.referralCode,
        })
        .expect(201);

      expect(res.body.referralCodeApplied).toBe(true);

      const created = await prisma.customer.findFirst({ where: { userId: res.body.user.id } });
      expect(created?.referredByCustomerId).toBe(customer.id);
    });

    it('never blocks signup on a mistyped/unknown referral code, but reports it as not applied', async () => {
      const email = uniqueRegisterEmail();

      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          fullName: 'Typo Customer',
          email,
          password: DEFAULT_PASSWORD,
          countryOfResidence: 'United Kingdom',
          referralCode: 'NOTAREALCODE',
        })
        .expect(201);

      expect(res.body.referralCodeApplied).toBe(false);
      expect(res.body.accessToken).toBeDefined();

      const created = await prisma.customer.findFirst({ where: { userId: res.body.user.id } });
      expect(created?.referredByCustomerId).toBeNull();
    });
  });

  describe('partner code', () => {
    it('applies a valid, active partner code and reports it as applied', async () => {
      const partner = await prisma.partner.create({
        data: { name: 'Test Association', code: `PART${randomBytes(3).toString('hex').toUpperCase()}`, type: 'ASSOCIATION', status: 'ACTIVE' },
      });
      const email = uniqueRegisterEmail();

      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          fullName: 'Partner-Referred Customer',
          email,
          password: DEFAULT_PASSWORD,
          countryOfResidence: 'United Kingdom',
          partnerCode: partner.code,
        })
        .expect(201);

      expect(res.body.partnerCodeApplied).toBe(true);

      const created = await prisma.customer.findFirst({ where: { userId: res.body.user.id } });
      expect(created?.referredByPartnerId).toBe(partner.id);
    });

    it('never blocks signup on an inactive partner code, but reports it as not applied', async () => {
      const partner = await prisma.partner.create({
        data: { name: 'Inactive Partner', code: `PART${randomBytes(3).toString('hex').toUpperCase()}`, type: 'AGENT', status: 'INACTIVE' },
      });
      const email = uniqueRegisterEmail();

      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          fullName: 'Blocked Partner Customer',
          email,
          password: DEFAULT_PASSWORD,
          countryOfResidence: 'United Kingdom',
          partnerCode: partner.code,
        })
        .expect(201);

      expect(res.body.partnerCodeApplied).toBe(false);
      expect(res.body.accessToken).toBeDefined();

      const created = await prisma.customer.findFirst({ where: { userId: res.body.user.id } });
      expect(created?.referredByPartnerId).toBeNull();
    });
  });
});
