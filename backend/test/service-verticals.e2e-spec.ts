import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { createCustomer, createStaff, prisma, login } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Platform Expansion PRD §6.2 "Legal / Document Services Vertical" / §6.3
 * "Healthcare Coordination Vertical" — both explicitly "zero architectural
 * changes": new ServiceType values riding the existing case engine and
 * standard-checklist pattern (same shape as arrival.e2e-spec.ts covers
 * for ASOJU Arrival). Real app, real Postgres.
 */
describe('Legal/Document and Healthcare service verticals', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;

  async function createCase(serviceType: string, description: string): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: description, location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType, description, location: 'Lagos', priority: 'STANDARD' })
      .expect(201);
    return caseRes.body.id;
  }

  beforeAll(async () => {
    app = await createTestApp();

    [customer, admin] = await Promise.all([
      createCustomer('service-verticals'),
      createStaff('service-verticals-admin', Role.ADMIN),
    ]);
    [customerToken, adminToken] = await Promise.all([login(app, customer.email), login(app, admin.email)]);

    // Platform Expansion PRD §4.2 — LEGAL_DOCUMENT_SERVICES now requires a
    // verified PoA on file (poa-guard.e2e-spec.ts covers the guard itself
    // in detail). One verified asset here covers every case this file
    // creates, same "never re-consumed" semantics as production.
    const submitted = await request(app.getHttpServer())
      .post('/api/me/verified-assets')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ type: 'POWER_OF_ATTORNEY', name: 'Service verticals test PoA' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/admin/verified-assets/${submitted.body.id}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('seeds the 9-item Legal/Document Services checklist onto the case', async () => {
    const caseId = await createCase('LEGAL_DOCUMENT_SERVICES', 'Retrieve title document from the land registry');
    const tasks = await prisma.caseTask.findMany({ where: { caseId }, orderBy: { sortOrder: 'asc' } });
    expect(tasks).toHaveLength(9);
    expect(tasks[0].label).toContain('Confirm the document(s)/title requested');
  });

  it('seeds the 9-item Healthcare Coordination checklist onto the case', async () => {
    const caseId = await createCase('HEALTHCARE_COORDINATION', 'Accompany beneficiary to hospital checkup');
    const tasks = await prisma.caseTask.findMany({ where: { caseId }, orderBy: { sortOrder: 'asc' } });
    expect(tasks).toHaveLength(9);
    expect(tasks[0].label).toContain('Confirm beneficiary details and hospital/clinic location');
  });

  it('exposes the correct case detail for both new service types', async () => {
    const legalCaseId = await createCase('LEGAL_DOCUMENT_SERVICES', 'CAC document retrieval');
    const legalCase = await request(app.getHttpServer())
      .get(`/api/cases/${legalCaseId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(legalCase.body.serviceType).toBe('LEGAL_DOCUMENT_SERVICES');

    const healthCaseId = await createCase('HEALTHCARE_COORDINATION', 'Hospital visit coordination');
    const healthCase = await request(app.getHttpServer())
      .get(`/api/cases/${healthCaseId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(healthCase.body.serviceType).toBe('HEALTHCARE_COORDINATION');
  });
});
