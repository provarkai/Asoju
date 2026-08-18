import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role, ServiceType } from '@prisma/client';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';

/**
 * docs/FRONTEND_HANDOFF_V1_GAP_MAP.md §1's Option B "additive layer" —
 * ServiceFamily is a derived/display concept for public-facing surfaces
 * only (homepage, service pages); the real ServiceType enum and every
 * module keyed off it are untouched. GET /service-families is genuinely
 * public (no auth) — same reasoning as AiPublicController's demo-message.
 */
describe('Service family (additive layer)', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let customerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();
      [customer, admin] = await Promise.all([createCustomer('svcfam'), createStaff('svcfam-admin', Role.ADMIN)]);
      [customerToken, adminToken] = await Promise.all([login(app, customer.email), login(app, admin.email)]);
    });
  });

  beforeEach(async () => {
    app = await ensureHealthyApp(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('GET /service-families is reachable with no Authorization header at all', async () => {
    const res = await request(app.getHttpServer()).get('/api/service-families').expect(200);
    expect(res.body).toHaveLength(6);
    expect(res.body.map((f: { slug: string }) => f.slug)).toEqual([
      'arrivals',
      'inspect',
      'build',
      'care',
      'verify',
      'assist',
    ]);
  });

  it('every real ServiceType value appears in exactly one family, and none are invented', async () => {
    const res = await request(app.getHttpServer()).get('/api/service-families').expect(200);
    const allListed: string[] = res.body.flatMap((f: { serviceTypes: string[] }) => f.serviceTypes);

    const realServiceTypes = Object.values(ServiceType);
    expect(new Set(allListed)).toEqual(new Set(realServiceTypes));
    expect(allListed).toHaveLength(realServiceTypes.length); // no duplicates across families

    const inspect = res.body.find((f: { slug: string }) => f.slug === 'inspect');
    expect(inspect.serviceTypes.sort()).toEqual(['ASSET_INSPECTION', 'PROPERTY_INSPECTION']);
    const care = res.body.find((f: { slug: string }) => f.slug === 'care');
    expect(care.serviceTypes.sort()).toEqual(['BEREAVEMENT_SUPPORT', 'FAMILY_SUPPORT', 'HEALTHCARE_COORDINATION']);
  });

  it('a case detail response carries the derived serviceFamily alongside the real serviceType, unmodified', async () => {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Family mapping test', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'CONSTRUCTION_SUPERVISION', description: 'Site visit', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);

    expect(caseRes.body.serviceType).toBe('CONSTRUCTION_SUPERVISION');

    // getCaseDetail (not convertToCase's own raw return) is the
    // public-facing surface this layer targets.
    const detail = await request(app.getHttpServer())
      .get(`/api/cases/${caseRes.body.id}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(detail.body.serviceType).toBe('CONSTRUCTION_SUPERVISION');
    expect(detail.body.serviceFamily).toBe('build');
  });

  it('the case list (GET /cases) also carries serviceFamily per case', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/cases')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const c of res.body) {
      expect(c.serviceFamily).toBeDefined();
    }
  });
});
