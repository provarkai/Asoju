// Must run before AppModule (and its transitive imports, e.g.
// AuthController's module-scope `parseInt(process.env.AUTH_THROTTLE_LIMIT, ...)`)
// is ever imported. ConfigModule.forRoot() also loads .env, but only once
// its @Module() decorator actually runs — which is AFTER every one of
// AppModule's own imports has already finished executing its top-level
// code, so anything read from process.env at module-scope elsewhere would
// silently see values from before .env was loaded. See main.ts for the
// same fix on the real (non-test) boot path.
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

/**
 * Boots the real Nest application (every module, every guard) against
 * whatever DATABASE_URL is set to — no mocked services, no stubbed
 * guards. Mirrors main.ts's bootstrap exactly so a test failure means the
 * real app would behave the same way, not just this harness.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}

/**
 * CI-observed flakiness (see test/jest-e2e.setup.ts) root cause, now
 * actually fixed rather than just retried: `app`/its Prisma pools are
 * created once per spec file in `beforeAll`. If a connection reset wedges
 * that shared instance mid-file, `jest.retryTimes` re-runs the failing
 * assertion against the same already-broken instance — every retry, and
 * every later test in the file, fails identically. This is the "larger,
 * all-spec-files change" that comment names and defers, now applied:
 * every spec file's `beforeEach` calls this before each test. A live app
 * answers instantly and this is a no-op; a wedged one gets closed
 * (best-effort — it may already be unusable) and rebuilt fresh, so a
 * connection reset costs at most the one test it happened during, not
 * the rest of the file.
 */
export async function ensureHealthyApp(app: INestApplication): Promise<INestApplication> {
  try {
    await request(app.getHttpServer()).get('/api/health').timeout(3000);
    return app;
  } catch {
    try {
      await app.close();
    } catch {
      // Already broken in a way close() can't clean up — nothing more to do.
    }
    return createTestApp();
  }
}
