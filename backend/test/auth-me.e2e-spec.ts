import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createAgent, login, prisma } from './utils/fixtures';

/**
 * #54 — GET /auth/me now includes agentProfile.id, the one thing the
 * field portal's wallet/trust-score/financial-plan/ledger pages needed
 * and had no way to resolve (those endpoints all take an Agent id, not
 * the User id the session already carries).
 */
describe('GET /auth/me — agentProfile', () => {
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

  it('includes the caller\'s own Agent id for a field agent', async () => {
    const agent = await createAgent('me-agent');
    const token = await login(app, agent.email);

    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.agentProfile).toEqual({ id: agent.agent.id });
  });

  it('is null for a role with no Agent row', async () => {
    const customer = await createCustomer('me-customer');
    const token = await login(app, customer.email);

    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.agentProfile).toBeNull();
  });
});
