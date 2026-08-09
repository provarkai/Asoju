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
