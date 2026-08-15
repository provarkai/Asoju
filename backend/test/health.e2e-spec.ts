import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp } from './utils/bootstrap';
import { prisma } from './utils/fixtures';

/**
 * Staging/production separation follow-up — every managed host needs
 * something to poll. Unauthenticated on purpose (see health.controller.ts).
 */
describe('Health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
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

  it('answers liveness with no auth required', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('answers readiness by actually querying the database', async () => {
    const res = await request(app.getHttpServer()).get('/api/health/ready').expect(200);
    expect(res.body.status).toBe('ok');
  });
});
