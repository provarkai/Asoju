import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Platform Expansion PRD §5.2 "Dynamic SLA by LGA/Region" — reuses §2.2's
 * regional-pricing zone classification (classifyZone) rather than a second
 * geography system. Real app, real Postgres; asserts the SLA window's
 * regional multiplier the same way case-ownership-sla.e2e-spec.ts asserts
 * priority (relative comparisons, no hardcoded env config).
 */
describe('Dynamic SLA by region', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;

  async function createCaseAt(location: string): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Regional SLA test case', location, channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location, priority: 'STANDARD' })
      .expect(201);
    return caseRes.body.id;
  }

  async function slaWindowHours(caseId: string): Promise<number> {
    const caseRow = await prisma.serviceCase.findUniqueOrThrow({ where: { id: caseId } });
    return (caseRow.slaTargetAt!.getTime() - caseRow.createdAt.getTime()) / (60 * 60 * 1000);
  }

  beforeAll(async () => {
    app = await createTestApp();

    [customer, admin] = await Promise.all([
      createCustomer('regional-sla'),
      createStaff('regional-sla-admin', Role.ADMIN),
    ]);
    [customerToken, adminToken] = await Promise.all([login(app, customer.email), login(app, admin.email)]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('gives Lagos the base SLA window — no regional adjustment for the operational hub', async () => {
    const caseId = await createCaseAt('Lagos');
    const window = await slaWindowHours(caseId);
    // DEFAULT_SLA_HOURS[STANDARD] in cases.service.ts.
    expect(window).toBeCloseTo(72, 2);
  });

  it('widens the window for South-West states outside Lagos, and widens it further for everywhere else', async () => {
    const [lagosId, southWestId, otherId] = await Promise.all([
      createCaseAt('Lagos'),
      createCaseAt('Ogun State'),
      createCaseAt('Kano'),
    ]);
    const [lagosWindow, southWestWindow, otherWindow] = await Promise.all([
      slaWindowHours(lagosId),
      slaWindowHours(southWestId),
      slaWindowHours(otherId),
    ]);

    expect(lagosWindow).toBeCloseTo(72, 2);
    expect(southWestWindow).toBeCloseTo(90, 2); // 72 * 1.25
    expect(otherWindow).toBeCloseTo(108, 2); // 72 * 1.5
    expect(southWestWindow).toBeGreaterThan(lagosWindow);
    expect(otherWindow).toBeGreaterThan(southWestWindow);
  });

  it('applies the same regional multiplier on top of priority, not instead of it', async () => {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Urgent regional SLA test', location: 'Kano', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Kano', priority: 'URGENT' })
      .expect(201);

    const window = await slaWindowHours(caseRes.body.id);
    // DEFAULT_SLA_HOURS[URGENT] (24) * OTHER's 1.5 multiplier.
    expect(window).toBeCloseTo(36, 2);
  });
});
