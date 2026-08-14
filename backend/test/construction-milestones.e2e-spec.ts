import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * Platform Expansion PRD §3.3 "Construction Milestone & % Completion
 * Tracker" — real app, real Postgres. The % complete aggregation itself
 * is computed client-side (frontend/src/components/MilestoneProgress.tsx)
 * per the PRD's own architectural note; this only has to prove the
 * checklist seeding actually carries the milestone tags, and that every
 * other service type is unaffected.
 */
describe('Construction milestone tracker', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;

  let customerToken: string;
  let adminToken: string;

  async function createCase(serviceType: string): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Milestone tracker test case', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType, description: 'Test case', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);
    return caseRes.body.id;
  }

  beforeAll(async () => {
    app = await createTestApp();

    [customer, admin] = await Promise.all([
      createCustomer('milestone'),
      createStaff('milestone-admin', Role.ADMIN),
    ]);
    [customerToken, adminToken] = await Promise.all([login(app, customer.email), login(app, admin.email)]);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('tags CONSTRUCTION_SUPERVISION checklist items with the five build-phase milestone groups', async () => {
    const caseId = await createCase('CONSTRUCTION_SUPERVISION');
    const tasks = await prisma.caseTask.findMany({ where: { caseId }, orderBy: { sortOrder: 'asc' } });

    const groups = tasks.map((t) => t.milestoneGroup).filter((g): g is NonNullable<typeof g> => g !== null);
    expect(new Set(groups)).toEqual(new Set(['FOUNDATION', 'DPC', 'SUPERSTRUCTURE', 'ROOFING', 'FINISHING']));

    // Each phase gets a verify + photograph pair; the closing items
    // (observations, materials, exceptions, submission) stay ungrouped.
    const foundationTasks = tasks.filter((t) => t.milestoneGroup === 'FOUNDATION');
    expect(foundationTasks).toHaveLength(2);
    const ungrouped = tasks.filter((t) => t.milestoneGroup === null);
    expect(ungrouped.length).toBeGreaterThan(0);
  });

  it('exposes milestoneGroup on the case detail tasks response', async () => {
    const caseId = await createCase('CONSTRUCTION_SUPERVISION');
    const detail = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    expect(detail.body.tasks.some((t: { milestoneGroup: string | null }) => t.milestoneGroup === 'FOUNDATION')).toBe(true);
  });

  it('leaves every other service type ungrouped — no milestoneGroup set', async () => {
    const caseId = await createCase('PROPERTY_INSPECTION');
    const tasks = await prisma.caseTask.findMany({ where: { caseId } });
    expect(tasks.every((t) => t.milestoneGroup === null)).toBe(true);
  });
});
