import { validateProductionEnv } from './validate-production-env';

const VALID_PROD_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  WHATSAPP_WEBHOOK_SECRET: 'a-real-shared-secret',
  DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/asoju',
  CORS_ORIGIN: 'https://yourdomain.example',
};

describe('validateProductionEnv — staging/production separation', () => {
  it('is a no-op outside production (dev/staging-as-dev/test)', () => {
    expect(() => validateProductionEnv({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => validateProductionEnv({})).not.toThrow();
  });

  it('passes with a fully-configured production env', () => {
    expect(() => validateProductionEnv(VALID_PROD_ENV)).not.toThrow();
  });

  it('refuses to boot with the checked-in dev-default JWT secret', () => {
    expect(() =>
      validateProductionEnv({ ...VALID_PROD_ENV, JWT_ACCESS_SECRET: 'change-me-access-secret' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses to boot with a missing JWT secret', () => {
    expect(() => validateProductionEnv({ ...VALID_PROD_ENV, JWT_REFRESH_SECRET: undefined })).toThrow(
      /JWT_REFRESH_SECRET/,
    );
  });

  it('refuses to boot with a too-short JWT secret even if not the exact dev default', () => {
    expect(() => validateProductionEnv({ ...VALID_PROD_ENV, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('refuses to boot with the checked-in dev-default WhatsApp webhook secret', () => {
    expect(() =>
      validateProductionEnv({ ...VALID_PROD_ENV, WHATSAPP_WEBHOOK_SECRET: 'change-me-whatsapp-webhook-secret' }),
    ).toThrow(/WHATSAPP_WEBHOOK_SECRET/);
  });

  it('refuses to boot without CORS_ORIGIN — the app would otherwise allow every origin', () => {
    expect(() => validateProductionEnv({ ...VALID_PROD_ENV, CORS_ORIGIN: undefined })).toThrow(/CORS_ORIGIN/);
  });

  it('refuses to boot without DATABASE_URL', () => {
    expect(() => validateProductionEnv({ ...VALID_PROD_ENV, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('collects every problem into one error instead of failing on the first', () => {
    try {
      validateProductionEnv({ NODE_ENV: 'production' });
      fail('expected validateProductionEnv to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/JWT_ACCESS_SECRET/);
      expect(message).toMatch(/JWT_REFRESH_SECRET/);
      expect(message).toMatch(/DATABASE_URL/);
      expect(message).toMatch(/CORS_ORIGIN/);
    }
  });
});
