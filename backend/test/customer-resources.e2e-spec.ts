import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Staff-facing counterpart to /me/* (CustomerResourcesController) — lets
 * someone triaging a request see a customer's saved beneficiaries/
 * properties/assets, plus the Section 12 P1 "customer service history"
 * view (GET customers/:customerId/history). No dedicated e2e coverage
 * existed for this controller before this spec, including its curated-
 * case-file PII redaction on /history (pii-restricted-roles.ts).
 */
describe('Customer resources (staff-facing)', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let rm: Awaited<ReturnType<typeof createStaff>>;
  let caseManager: Awaited<ReturnType<typeof createStaff>>;
  let qc: Awaited<ReturnType<typeof createStaff>>;
  let rmToken: string;
  let caseManagerToken: string;
  let qcToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();
      [customer, rm, caseManager, qc] = await Promise.all([
        createCustomer('cr'),
        createStaff('cr-rm', Role.RELATIONSHIP_MANAGER),
        createStaff('cr-cm', Role.CASE_MANAGER),
        createStaff('cr-qc', Role.QUALITY_CONTROL),
      ]);
      [rmToken, caseManagerToken, qcToken] = await Promise.all([
        login(app, rm.email),
        login(app, caseManager.email),
        login(app, qc.email),
      ]);

      await prisma.beneficiary.create({
        data: { customerId: customer.customer.id, fullName: 'Test Beneficiary', relationship: 'Sibling' },
      });
      await prisma.property.create({
        data: { customerId: customer.customer.id, address: '1 Test Close', city: 'Lagos' },
      });
      await prisma.asset.create({
        data: { customerId: customer.customer.id, description: 'Test asset', assetType: 'VEHICLE' },
      });
    });
  });

  beforeEach(async () => {
    app = await ensureHealthyApp(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('lists the customer\'s saved beneficiaries/properties/assets for a triage-eligible role', async () => {
    const [beneficiaries, properties, assets] = await Promise.all([
      request(app.getHttpServer())
        .get(`/api/customers/${customer.customer.id}/beneficiaries`)
        .set('Authorization', `Bearer ${rmToken}`)
        .expect(200),
      request(app.getHttpServer())
        .get(`/api/customers/${customer.customer.id}/properties`)
        .set('Authorization', `Bearer ${rmToken}`)
        .expect(200),
      request(app.getHttpServer())
        .get(`/api/customers/${customer.customer.id}/assets`)
        .set('Authorization', `Bearer ${rmToken}`)
        .expect(200),
    ]);
    expect(beneficiaries.body.some((b: { fullName: string }) => b.fullName === 'Test Beneficiary')).toBe(true);
    expect(properties.body.some((p: { address: string }) => p.address === '1 Test Close')).toBe(true);
    expect(assets.body.some((a: { description: string }) => a.description === 'Test asset')).toBe(true);
  });

  it('shows the customer\'s real name/contact in service history for an unrestricted role (RM)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/customers/${customer.customer.id}/history`)
      .set('Authorization', `Bearer ${rmToken}`)
      .expect(200);
    expect(res.body.customer.fullName).toBe(customer.customer.fullName);
    expect(res.body.customer.email).toBe(customer.email);
  });

  it('redacts the customer\'s name/contact in service history for a PII-restricted role (Case Manager)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/customers/${customer.customer.id}/history`)
      .set('Authorization', `Bearer ${caseManagerToken}`)
      .expect(200);
    expect(res.body.customer.fullName).toBe('Client (name withheld)');
    expect(res.body.customer.email).toBeNull();
    expect(res.body.customer.phone).toBeNull();
  });

  it('rejects a role outside the triage set (Quality Control) from the beneficiaries/properties/assets lookups', async () => {
    await request(app.getHttpServer())
      .get(`/api/customers/${customer.customer.id}/beneficiaries`)
      .set('Authorization', `Bearer ${qcToken}`)
      .expect(403);
  });

  it('404s on a customerId that does not exist', async () => {
    await request(app.getHttpServer())
      .get('/api/customers/00000000-0000-0000-0000-000000000000/history')
      .set('Authorization', `Bearer ${rmToken}`)
      .expect(404);
  });
});
