import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BillingCurrency } from '@prisma/client';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, login, prisma } from './utils/fixtures';

/**
 * "converted at the current rate" — GET /me/fx-rate, backed by
 * FxRateService's live (keyless, no dry-run) Frankfurter lookup. Real
 * network call, same as every other real-dependency e2e test in this
 * suite that doesn't need credentials to exercise for real.
 */
describe('GET /me/fx-rate', () => {
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

  it('returns a live rate > 0 for an explicit ?to=GBP', async () => {
    const { email } = await createCustomer('fxrate-explicit');
    const token = await login(app, email);

    const res = await request(app.getHttpServer())
      .get('/api/me/fx-rate?to=GBP')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.currency).toBe('GBP');
    expect(typeof res.body.rate).toBe('number');
    expect(res.body.rate).toBeGreaterThan(0);
  });

  it('defaults to the customer\'s own billingCurrency when ?to is omitted', async () => {
    const { user, email } = await createCustomer('fxrate-default');
    await prisma.user.update({ where: { id: user.id }, data: { billingCurrency: BillingCurrency.EUR } });
    const token = await login(app, email);

    const res = await request(app.getHttpServer()).get('/api/me/fx-rate').set('Authorization', `Bearer ${token}`).expect(200);

    expect(res.body.currency).toBe('EUR');
    expect(res.body.rate).toBeGreaterThan(0);
  });

  it('returns rate 1 with no live call for USD (or an account with no billingCurrency set)', async () => {
    const { email } = await createCustomer('fxrate-usd'); // fixture-created accounts have no billingCurrency
    const token = await login(app, email);

    const res = await request(app.getHttpServer()).get('/api/me/fx-rate').set('Authorization', `Bearer ${token}`).expect(200);

    expect(res.body).toEqual({ currency: 'USD', rate: 1 });
  });

  it('rejects an unsupported currency', async () => {
    const { email } = await createCustomer('fxrate-bad');
    const token = await login(app, email);

    await request(app.getHttpServer()).get('/api/me/fx-rate?to=NGN').set('Authorization', `Bearer ${token}`).expect(400);
  });
});
