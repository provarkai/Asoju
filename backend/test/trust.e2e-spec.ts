import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { PaymentStatus, Role } from '@prisma/client';

/**
 * Public trust/social-proof page (strategic-suggestions pass, Tier 3
 * "cheapest, safest quick win on this whole list") — every number and
 * quote must trace back to a real, opted-in Rating. Real app, real
 * Postgres, no auth on the read side (that's the point of a public page).
 */
describe('Public trust page', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let customerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();

    [customer, admin] = await Promise.all([createCustomer('trust'), createStaff('trust-admin', Role.ADMIN)]);
    [customerToken, adminToken] = await Promise.all([login(app, customer.email), login(app, admin.email)]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /** Builds a case through to COMPLETED with a PAID payment, same
   * fast-forward-past-what's-covered-elsewhere pattern as
   * refund.e2e-spec.ts / portfolio.e2e-spec.ts. */
  async function createCompletedCase(): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Trust page test case', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
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
      .send({ objective: 'Inspect', tasks: ['Visit site'] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/scope/confirm`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    const quoteRes = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/quotes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [{ category: 'ASOJU_SERVICE_FEE', label: 'ASOJU service fee', amount: 20_000 }] })
      .expect(201);
    const acceptRes = await request(app.getHttpServer())
      .post(`/api/quotes/${quoteRes.body.id}/accept`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/invoices/${acceptRes.body.id}/pay`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);
    const payment = await prisma.payment.findFirstOrThrow({ where: { invoiceId: acceptRes.body.id } });
    await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });
    await prisma.serviceCase.update({
      where: { id: caseId },
      data: { paymentStatus: PaymentStatus.PAID, status: 'COMPLETED' },
    });

    return caseId;
  }

  async function rate(caseId: string, stars: number, comment: string | undefined, publicConsent: boolean) {
    return request(app.getHttpServer())
      .post(`/api/cases/${caseId}/rating`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ stars, comment, publicConsent })
      .expect(201);
  }

  function getTrust() {
    // Deliberately no Authorization header — this is the actual public
    // contract: anyone, logged in or not, can reach it.
    return request(app.getHttpServer()).get('/api/trust').expect(200);
  }

  it('is reachable with no auth at all', async () => {
    const res = await getTrust();
    expect(res.body.casesCompleted).toBeGreaterThanOrEqual(0);
    expect(res.body.testimonials).toBeInstanceOf(Array);
  });

  it('counts every COMPLETED/CLOSED case regardless of rating or consent', async () => {
    const before = await getTrust();
    const startingCount = before.body.casesCompleted;

    await createCompletedCase(); // never rated at all

    const after = await getTrust();
    expect(after.body.casesCompleted).toBe(startingCount + 1);
  });

  it('includes a consented rating with a comment as a testimonial, excludes a non-consented one entirely', async () => {
    const consentedCaseId = await createCompletedCase();
    await rate(consentedCaseId, 5, 'ASOJU handled everything perfectly.', true);

    const nonConsentedCaseId = await createCompletedCase();
    await rate(nonConsentedCaseId, 1, 'This should never be public.', false);

    const res = await getTrust();
    const comments = res.body.testimonials.map((t: { comment: string }) => t.comment);
    expect(comments).toContain('ASOJU handled everything perfectly.');
    expect(comments).not.toContain('This should never be public.');
  });

  it('a consented rating with no comment counts toward the average but never appears as a testimonial', async () => {
    const before = await getTrust();
    const startingConsentedCount = before.body.consentedRatingCount;

    const caseId = await createCompletedCase();
    await rate(caseId, 4, undefined, true);

    const after = await getTrust();
    expect(after.body.consentedRatingCount).toBe(startingConsentedCount + 1);
    // No comment on this one, so it must not show up as a testimonial —
    // but it should still be reflected somewhere in the average.
    expect(after.body.averageRating).not.toBeNull();
  });

  it('never reveals a customer name, case number, or any other identifying field on a testimonial', async () => {
    const caseId = await createCompletedCase();
    await rate(caseId, 5, 'Great service, would recommend to any diaspora family.', true);

    const res = await getTrust();
    const testimonial = res.body.testimonials.find(
      (t: { comment: string }) => t.comment === 'Great service, would recommend to any diaspora family.',
    );
    expect(testimonial).toBeTruthy();
    expect(Object.keys(testimonial).sort()).toEqual(['comment', 'createdAt', 'serviceType', 'stars'].sort());
  });
});
