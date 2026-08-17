import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Section 7 — thumbs up/down feedback on individual AI Concierge replies.
 * Real app, real Postgres.
 */
describe('AI Concierge feedback', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let agent: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let agentToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();

      [customer, agent] = await Promise.all([
        createCustomer('concierge-fb'),
        createStaff('concierge-fb-agent', Role.FIELD_AGENT),
      ]);
      [customerToken, agentToken] = await Promise.all([login(app, customer.email), login(app, agent.email)]);

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

  it('records thumbs-up feedback on a concierge reply', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ai/concierge/feedback')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        rating: 'UP',
        userMessage: 'Verify a plot in Lekki',
        aiReply: 'Got it, tell me more about the location.',
        hadQuote: false,
      })
      .expect(201);
    expect(res.body.rating).toBe('UP');
    expect(res.body.hadQuote).toBe(false);

    const stored = await prisma.conciergeFeedback.findUnique({ where: { id: res.body.id } });
    expect(stored?.userMessage).toBe('Verify a plot in Lekki');
  });

  it('records thumbs-down feedback with hadQuote true', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ai/concierge/feedback')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        rating: 'DOWN',
        userMessage: 'That quote seems too high',
        aiReply: 'Here is a quote for NGN 200,000.',
        hadQuote: true,
      })
      .expect(201);
    expect(res.body.rating).toBe('DOWN');
    expect(res.body.hadQuote).toBe(true);
  });

  it('defaults hadQuote to false when omitted', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ai/concierge/feedback')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rating: 'UP', userMessage: 'Hi', aiReply: 'Hello!' })
      .expect(201);
    expect(res.body.hadQuote).toBe(false);
  });

  it('rejects an invalid rating value', async () => {
    await request(app.getHttpServer())
      .post('/api/ai/concierge/feedback')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rating: 'SIDEWAYS', userMessage: 'Hi', aiReply: 'Hello!' })
      .expect(400);
  });

  it('rejects an empty userMessage or aiReply', async () => {
    await request(app.getHttpServer())
      .post('/api/ai/concierge/feedback')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rating: 'UP', userMessage: '', aiReply: 'Hello!' })
      .expect(400);
  });

  it('is not reachable by a non-customer role', async () => {
    await request(app.getHttpServer())
      .post('/api/ai/concierge/feedback')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ rating: 'UP', userMessage: 'Hi', aiReply: 'Hello!' })
      .expect(403);
  });
});
