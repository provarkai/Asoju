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

  // A real user hit this live: `phone` is optional but @unique at the DB
  // level (schema.prisma), and register() only pre-checked email — a
  // second registration reusing a phone already on file skipped straight
  // to prisma.user.create(), which threw an uncaught P2002 that NestJS's
  // default filter turned into a bare 500 instead of a normal 409.
  it('rejects a duplicate phone number with a friendly 409, not a 500', async () => {
    const phone = `+234803${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ fullName: 'First', email: uniqueRegisterEmail(), password: DEFAULT_PASSWORD, countryOfResidence: 'United Kingdom', phone })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ fullName: 'Second', email: uniqueRegisterEmail(), password: DEFAULT_PASSWORD, countryOfResidence: 'United Kingdom', phone })
      .expect(409);

    expect(res.body.message).toMatch(/phone/i);
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
