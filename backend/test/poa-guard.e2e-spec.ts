import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Platform Expansion PRD §4.2 "Power of Attorney (PoA) Repository &
 * Verification" — "Introduces a VERIFIED_POA_REQUIRED guard on specific
 * service types." Submission/listing/staff-verification of a
 * VerifiedAsset already existed (vault.e2e-spec.ts) — this covers just
 * the new gate: LEGAL_DOCUMENT_SERVICES cases can't be created without a
 * verified PoA on file, and once verified the same asset covers every
 * future case of that type (never re-consumed). Real app, real Postgres.
 */
describe('PoA verified-asset guard', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;

  async function createRequest(): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'PoA guard test request', location: 'Lagos', channel: 'web' })
      .expect(201);
    return reqRes.body.id;
  }

  async function submitAndVerifyPoa() {
    const submitted = await request(app.getHttpServer())
      .post('/api/me/verified-assets')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ type: 'POWER_OF_ATTORNEY', name: 'PoA guard test asset' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/admin/verified-assets/${submitted.body.id}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  }

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();

      [customer, admin] = await Promise.all([createCustomer('poa-guard'), createStaff('poa-guard-admin', Role.ADMIN)]);
      [customerToken, adminToken] = await Promise.all([login(app, customer.email), login(app, admin.email)]);

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

  it('rejects converting to LEGAL_DOCUMENT_SERVICES with no verified PoA on file', async () => {
    const requestId = await createRequest();
    await request(app.getHttpServer())
      .post(`/api/service-requests/${requestId}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'LEGAL_DOCUMENT_SERVICES', description: 'Title verification', location: 'Lagos', priority: 'STANDARD' })
      .expect(400);
  });

  it('rejects it too when a PoA was submitted but never verified by staff', async () => {
    const submitted = await request(app.getHttpServer())
      .post('/api/me/verified-assets')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ type: 'POWER_OF_ATTORNEY', name: 'Unverified PoA' })
      .expect(201);
    expect(submitted.body.verified).toBe(false);

    const requestId = await createRequest();
    await request(app.getHttpServer())
      .post(`/api/service-requests/${requestId}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'LEGAL_DOCUMENT_SERVICES', description: 'Title verification', location: 'Lagos', priority: 'STANDARD' })
      .expect(400);
  });

  it('lets the conversion through once a PoA is submitted and staff-verified, and the same PoA covers a second case', async () => {
    await submitAndVerifyPoa();

    const firstRequestId = await createRequest();
    await request(app.getHttpServer())
      .post(`/api/service-requests/${firstRequestId}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'LEGAL_DOCUMENT_SERVICES', description: 'Title verification', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);

    // The verified PoA is never consumed/re-checked-out — it covers a
    // second, later case of the same type without resubmission.
    const secondRequestId = await createRequest();
    await request(app.getHttpServer())
      .post(`/api/service-requests/${secondRequestId}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'LEGAL_DOCUMENT_SERVICES', description: 'CAC retrieval', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);
  });

  it('never gates unrelated service types on a PoA', async () => {
    const requestId = await createRequest();
    await request(app.getHttpServer())
      .post(`/api/service-requests/${requestId}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Routine inspection', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);
  });
});
