// Must be the first import. ConfigModule.forRoot() (in app.module.ts) also
// loads .env, but only once its @Module() decorator actually runs — which
// is AFTER every one of AppModule's own imports has already finished
// executing its top-level code. Anything read from process.env at
// module-scope elsewhere (e.g. AuthController's
// `parseInt(process.env.AUTH_THROTTLE_LIMIT, ...)`, evaluated once when
// the class is defined) would otherwise silently see values from before
// .env was loaded — harmless on a real host like Railway, which injects
// env vars directly with no .env file to race against, but wrong for
// anyone running this from a checked-out .env file (local dev, CI).
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { validateProductionEnv } from './config/validate-production-env';

async function bootstrap() {
  // Staging/production separation — crash loudly at startup rather than
  // run silently insecure on a dev-shaped config (see the file for what
  // this actually checks).
  validateProductionEnv();

  // rawBody: true preserves the exact request bytes on `request.rawBody`
  // alongside normal JSON parsing — PaystackWebhookGuard needs those exact
  // bytes to verify the HMAC signature; a re-serialized parsed body would
  // not reproduce the same hash.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.use(helmet());
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });

  // Strip unknown fields and coerce types at the boundary — the AI layer and
  // client apps must never be able to smuggle extra fields into a DTO
  // (Section 7.6: LLM produces a structured ACTION, not direct DB writes).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`ASOJU backend listening on port ${port}`);
}

bootstrap();
