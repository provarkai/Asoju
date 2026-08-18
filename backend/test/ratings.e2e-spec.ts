import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Section 12 P1 "ratings → provider/agent performance scoring"
 * (POST cases/:caseId/rating). No dedicated e2e coverage existed —
 * agent-tiering.e2e-spec.ts exercises one call incidentally to test tier
 * computation, not the rating endpoint's own rules.
 */
describe('Case ratings', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let otherCustomer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let customerToken: string;
  let otherCustomerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();
      [customer, otherCustomer, admin] = await Promise.all([
        createCustomer('rating'),
        createCustomer('rating-other'),
        createStaff('rating-admin', Role.ADMIN),
      ]);
      [customerToken, otherCustomerToken, adminToken] = await Promise.all([
        login(app, customer.email),
        login(app, otherCustomer.email),
        login(app, admin.email),
      ]);
    });
  });

  beforeEach(async () => {
    app = await ensureHealthyApp(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createCase(status: 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED' = 'COMPLETED'): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Rating test case', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);
    await prisma.serviceCase.update({ where: { id: caseRes.body.id }, data: { status } });
    return caseRes.body.id;
  }

  it('rates a COMPLETED case once, with the exact stars/comment submitted', async () => {
    const caseId = await createCase('COMPLETED');
    const res = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/rating`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ stars: 4, comment: 'Solid work' })
      .expect(201);
    expect(res.body.stars).toBe(4);
    expect(res.body.comment).toBe('Solid work');
  });

  it('also accepts a rating on a CLOSED case', async () => {
    const caseId = await createCase('CLOSED');
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/rating`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ stars: 5 })
      .expect(201);
  });

  it('rejects rating a case that is not yet completed', async () => {
    const caseId = await createCase('IN_PROGRESS');
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/rating`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ stars: 3 })
      .expect(400);
  });

  it('rejects a second rating on the same case', async () => {
    const caseId = await createCase('COMPLETED');
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/rating`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ stars: 5 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/rating`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ stars: 1 })
      .expect(409);
  });

  it('rejects a star rating outside 1-5', async () => {
    const caseId = await createCase('COMPLETED');
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/rating`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ stars: 6 })
      .expect(400);
  });

  it('rejects a customer rating a case that is not theirs (IDOR)', async () => {
    const caseId = await createCase('COMPLETED');
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/rating`)
      .set('Authorization', `Bearer ${otherCustomerToken}`)
      .send({ stars: 5 })
      .expect(403);
  });
});
