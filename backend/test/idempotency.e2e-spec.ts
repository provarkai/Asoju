import { ConflictException, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role, IdempotencyOperation } from '@prisma/client';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';

/**
 * docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 2 — the `Idempotency-Key`
 * header wiring on POST /service-requests and POST /invoices/:id/pay, plus
 * the IdempotencyService that backs both. Real app, real Postgres.
 */
describe('Idempotency-Key handling', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let otherCustomer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let otherCustomerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();

    [customer, otherCustomer, admin] = await Promise.all([
      createCustomer('idem'),
      createCustomer('idem-other'),
      createStaff('idem-admin', Role.ADMIN),
    ]);
    [customerToken, otherCustomerToken, adminToken] = await Promise.all([
      login(app, customer.email),
      login(app, otherCustomer.email),
      login(app, admin.email),
    ]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('POST /service-requests', () => {
    it('with no Idempotency-Key header, two submissions create two distinct requests (unchanged pre-existing behaviour)', async () => {
      const first = await request(app.getHttpServer())
        .post('/api/service-requests')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ rawDescription: 'No key A', location: 'Lagos, Nigeria', channel: 'web' })
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/api/service-requests')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ rawDescription: 'No key B', location: 'Lagos, Nigeria', channel: 'web' })
        .expect(201);

      expect(first.body.id).not.toBe(second.body.id);
    });

    it('replays the same result for a repeated Idempotency-Key instead of creating a second request', async () => {
      const key = randomUUID();
      // Description carries the key itself so a jest.retryTimes() rerun
      // (see jest-e2e.setup.ts — the well-known connect ECONNRESET retry)
      // gets a fresh, un-collidable description on each attempt instead of
      // this count assertion picking up rows a previous, aborted attempt
      // already left behind.
      const description = `Idempotent create ${key}`;
      const first = await request(app.getHttpServer())
        .post('/api/service-requests')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', key)
        .send({ rawDescription: description, location: 'Lagos, Nigeria', channel: 'web' })
        .expect(201);

      const replay = await request(app.getHttpServer())
        .post('/api/service-requests')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', key)
        .send({ rawDescription: 'Different body — must be ignored on replay', location: 'Kano', channel: 'web' })
        .expect(201);

      expect(replay.body.id).toBe(first.body.id);
      expect(replay.body.rawDescription).toBe(description);

      const count = await prisma.serviceRequest.count({ where: { rawDescription: description } });
      expect(count).toBe(1);
    });

    it('scopes the key per-actor — two different customers reusing the same literal key both succeed independently', async () => {
      const key = randomUUID();
      const mine = await request(app.getHttpServer())
        .post('/api/service-requests')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', key)
        .send({ rawDescription: 'Shared key — customer A', location: 'Lagos, Nigeria', channel: 'web' })
        .expect(201);
      const theirs = await request(app.getHttpServer())
        .post('/api/service-requests')
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .set('Idempotency-Key', key)
        .send({ rawDescription: 'Shared key — customer B', location: 'Lagos, Nigeria', channel: 'web' })
        .expect(201);

      expect(mine.body.id).not.toBe(theirs.body.id);
    });

    it('a concurrent duplicate request with the same brand-new key gets 409 instead of double-processing', async () => {
      const key = randomUUID();
      // Same retry-safety reasoning as the replay test above — scope both
      // descriptions to this attempt's key.
      const descA = `Race A ${key}`;
      const descB = `Race B ${key}`;
      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/service-requests')
          .set('Authorization', `Bearer ${customerToken}`)
          .set('Idempotency-Key', key)
          .send({ rawDescription: descA, location: 'Lagos, Nigeria', channel: 'web' }),
        request(app.getHttpServer())
          .post('/api/service-requests')
          .set('Authorization', `Bearer ${customerToken}`)
          .set('Idempotency-Key', key)
          .send({ rawDescription: descB, location: 'Lagos, Nigeria', channel: 'web' }),
      ]);

      const statuses = [a.status, b.status].sort();
      // One request wins the race and is processed (201); the other is
      // rejected as already-in-flight (409) rather than silently
      // double-creating a service request under the same key.
      expect(statuses).toEqual([201, 409]);

      const count = await prisma.serviceRequest.count({
        where: { rawDescription: { in: [descA, descB] } },
      });
      expect(count).toBe(1);
    });
  });

  describe('POST /invoices/:invoiceId/pay', () => {
    async function createAcceptedInvoice(): Promise<string> {
      const reqRes = await request(app.getHttpServer())
        .post('/api/service-requests')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ rawDescription: 'Payment idempotency case', location: 'Lagos, Nigeria', channel: 'web' })
        .expect(201);

      const caseRes = await request(app.getHttpServer())
        .post(`/api/service-requests/${reqRes.body.id}/convert`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          serviceType: 'PROPERTY_INSPECTION',
          description: 'Payment idempotency case',
          location: 'Lagos, Nigeria',
          priority: 'STANDARD',
          tier: 'CONCIERGE',
        })
        .expect(201);
      const caseId = caseRes.body.id;

      await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ toStatus: 'SUBMITTED' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ toStatus: 'UNDER_REVIEW' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/scope`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ objective: 'Handle the request', tasks: ['Visit site'] })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/scope/confirm`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);

      const quoteRes = await request(app.getHttpServer())
        .post(`/api/cases/${caseId}/quotes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lines: [{ category: 'ASOJU_SERVICE_FEE', label: 'Service fee', amount: 75000 }] })
        .expect(201);

      const invoiceRes = await request(app.getHttpServer())
        .post(`/api/quotes/${quoteRes.body.id}/accept`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(201);

      return invoiceRes.body.id;
    }

    it('replays the same payment reference for a repeated Idempotency-Key instead of starting a second checkout', async () => {
      const invoiceId = await createAcceptedInvoice();
      const key = randomUUID();

      const first = await request(app.getHttpServer())
        .post(`/api/invoices/${invoiceId}/pay`)
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', key)
        .send({})
        .expect(201);
      expect(first.body.replay).toBeUndefined();
      expect(first.body.reference).toBeTruthy();

      const replay = await request(app.getHttpServer())
        .post(`/api/invoices/${invoiceId}/pay`)
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', key)
        .send({})
        .expect(201);
      expect(replay.body.replay).toBe(true);
      expect(replay.body.reference).toBe(first.body.reference);
      // No authorizationUrl on replay — Paystack's hosted-checkout URL is
      // only ever handed back once and is never persisted.
      expect(replay.body.authorizationUrl).toBeUndefined();

      const paymentCount = await prisma.payment.count({ where: { invoiceId } });
      expect(paymentCount).toBe(1);
    });

    it('without a key, a second call against the same invoice is blocked by the pre-existing "already paid"/business-rule path, not idempotency', async () => {
      // Sanity check that omitting the header keeps exactly the prior
      // behaviour: nothing here is a fresh business rule introduced by
      // Phase 2, since no idempotency record is ever consulted.
      const invoiceId = await createAcceptedInvoice();
      const first = await request(app.getHttpServer())
        .post(`/api/invoices/${invoiceId}/pay`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({})
        .expect(201);
      expect(first.body.replay).toBeUndefined();

      // A second no-key call re-runs doInitiatePayment fully; it doesn't
      // reject outright (no PAID payment exists yet), demonstrating the
      // absence of the header truly skips all idempotency bookkeeping.
      const second = await request(app.getHttpServer())
        .post(`/api/invoices/${invoiceId}/pay`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({})
        .expect(201);
      expect(second.body.reference).not.toBe(first.body.reference);

      const paymentCount = await prisma.payment.count({ where: { invoiceId } });
      expect(paymentCount).toBe(2);
    });
  });

  describe('IdempotencyService.begin() directly — race safety', () => {
    it('lets exactly one of two truly concurrent begin() calls with a brand-new key proceed', async () => {
      const idempotency = app.get(IdempotencyService);
      const key = randomUUID();
      const actorId = customer.user.id;

      const results = await Promise.allSettled([
        idempotency.begin(IdempotencyOperation.SERVICE_REQUEST_CREATE, key, actorId),
        idempotency.begin(IdempotencyOperation.SERVICE_REQUEST_CREATE, key, actorId),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);

      const record = await prisma.idempotencyRecord.findUniqueOrThrow({
        where: {
          operation_idempotencyKey_actorId: {
            operation: IdempotencyOperation.SERVICE_REQUEST_CREATE,
            idempotencyKey: key,
            actorId,
          },
        },
      });
      expect(record.status).toBe('PROCESSING');
    });

    it('complete() then begin() with the same key returns shouldProceed:false and the stored resultReference', async () => {
      const idempotency = app.get(IdempotencyService);
      const key = randomUUID();
      const actorId = customer.user.id;

      const first = await idempotency.begin(IdempotencyOperation.PAYMENT_INITIATE, key, actorId);
      expect(first.shouldProceed).toBe(true);
      await idempotency.complete(IdempotencyOperation.PAYMENT_INITIATE, key, actorId, 'some-payment-id');

      const second = await idempotency.begin(IdempotencyOperation.PAYMENT_INITIATE, key, actorId);
      expect(second).toEqual({ shouldProceed: false, resultReference: 'some-payment-id' });
    });

    it('fail() clears the record so a retried key can proceed again', async () => {
      const idempotency = app.get(IdempotencyService);
      const key = randomUUID();
      const actorId = customer.user.id;

      const first = await idempotency.begin(IdempotencyOperation.PAYMENT_INITIATE, key, actorId);
      expect(first.shouldProceed).toBe(true);
      await idempotency.fail(IdempotencyOperation.PAYMENT_INITIATE, key, actorId);

      const retry = await idempotency.begin(IdempotencyOperation.PAYMENT_INITIATE, key, actorId);
      expect(retry.shouldProceed).toBe(true);
    });
  });
});
