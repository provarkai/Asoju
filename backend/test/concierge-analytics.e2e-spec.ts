import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { prisma } from './utils/fixtures';

/**
 * FRONTEND_HANDOFF_V1_GAP_MAP.md §5/§8 — first-party AI Concierge usage
 * analytics. Public, unauthenticated (most of this traffic is anonymous
 * homepage/service-page visitors), and privacy-by-construction: this
 * suite exists specifically to prove `metadata` can't smuggle raw text
 * through, not just that a well-formed event gets stored.
 */
describe('AI Concierge analytics events', () => {
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

  it('records a bare event with no metadata, no auth required', async () => {
    await request(app.getHttpServer())
      .post('/api/ai/concierge/analytics-event')
      .send({ name: 'CONCIERGE_OPENED', sessionId: 'sess-bare' })
      .expect(204);

    const stored = await prisma.conciergeAnalyticsEvent.findFirst({ where: { sessionId: 'sess-bare' } });
    expect(stored?.name).toBe('CONCIERGE_OPENED');
    expect(stored?.metadata).toBeNull();
  });

  it('records an event with bounded metadata', async () => {
    await request(app.getHttpServer())
      .post('/api/ai/concierge/analytics-event')
      .send({ name: 'QUICK_PROMPT_CLICKED', sessionId: 'sess-meta', metadata: { promptIndex: 2, source: 'homepage' } })
      .expect(204);

    const stored = await prisma.conciergeAnalyticsEvent.findFirst({ where: { sessionId: 'sess-meta' } });
    expect(stored?.metadata).toEqual({ promptIndex: 2, source: 'homepage' });
  });

  it('rejects an unknown event name', async () => {
    await request(app.getHttpServer())
      .post('/api/ai/concierge/analytics-event')
      .send({ name: 'SOMETHING_MADE_UP', sessionId: 'sess-bad-name' })
      .expect(400);
  });

  it('rejects metadata carrying a raw message instead of coarse fields', async () => {
    await request(app.getHttpServer())
      .post('/api/ai/concierge/analytics-event')
      .send({
        name: 'MESSAGE_SENT',
        sessionId: 'sess-smuggle',
        metadata: { userMessage: 'My father is sick and I need someone to check on the farm in Ekiti urgently' },
      })
      .expect(400);
  });

  it('rejects metadata with a nested object (only flat string/number/boolean allowed)', async () => {
    await request(app.getHttpServer())
      .post('/api/ai/concierge/analytics-event')
      .send({ name: 'MESSAGE_SENT', sessionId: 'sess-nested', metadata: { turn: { number: 1 } } })
      .expect(400);
  });

  it('rejects metadata with too many keys', async () => {
    await request(app.getHttpServer())
      .post('/api/ai/concierge/analytics-event')
      .send({
        name: 'MESSAGE_SENT',
        sessionId: 'sess-toomany',
        metadata: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 },
      })
      .expect(400);
  });

  it('rejects a missing sessionId', async () => {
    await request(app.getHttpServer())
      .post('/api/ai/concierge/analytics-event')
      .send({ name: 'CONCIERGE_OPENED' })
      .expect(400);
  });
});
