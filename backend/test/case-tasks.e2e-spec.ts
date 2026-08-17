import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, ensureHealthyApp, withSetupRetry } from './utils/bootstrap';
import { createCustomer, createStaff, login, prisma } from './utils/fixtures';
import { Role } from '@prisma/client';

/**
 * "A case's checklist is fixed at creation time from checklist-templates.ts
 * — there's no UI yet to customize a checklist per case, only per service
 * type" (README, previously an open gap). POST/PATCH/DELETE
 * cases/:caseId/tasks close it: staff can add a case-specific checklist
 * item on top of the template, edit it, or remove it — but never touch one
 * that's already been completed by a field agent (completeTask stays the
 * only route that can flip isComplete).
 */
describe('Per-case checklist customization', () => {
  let app: INestApplication;

  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let admin: Awaited<ReturnType<typeof createStaff>>;
  let rm: Awaited<ReturnType<typeof createStaff>>;
  let customerToken: string;
  let adminToken: string;
  let rmToken: string;

  beforeAll(async () => {
    await withSetupRetry(async () => {
      app = await createTestApp();
      [customer, admin, rm] = await Promise.all([
        createCustomer('tasks'),
        createStaff('tasks-admin', Role.ADMIN),
        createStaff('tasks-rm', Role.RELATIONSHIP_MANAGER),
      ]);
      [customerToken, adminToken, rmToken] = await Promise.all([
        login(app, customer.email),
        login(app, admin.email),
        login(app, rm.email),
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

  async function createCase(): Promise<string> {
    const reqRes = await request(app.getHttpServer())
      .post('/api/service-requests')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rawDescription: 'Checklist test case', location: 'Lagos', channel: 'web' })
      .expect(201);
    const caseRes = await request(app.getHttpServer())
      .post(`/api/service-requests/${reqRes.body.id}/convert`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceType: 'PROPERTY_INSPECTION', description: 'Inspect', location: 'Lagos', priority: 'STANDARD' })
      .expect(201);
    return caseRes.body.id;
  }

  it('seeds the template checklist and appends a new item after it', async () => {
    const caseId = await createCase();
    const before = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const templateCount = before.body.tasks.length;
    expect(templateCount).toBeGreaterThan(0);

    const res = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/tasks`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Confirm gate access code with the caretaker' })
      .expect(201);
    expect(res.body.isRequired).toBe(true);
    expect(res.body.sortOrder).toBe(templateCount);

    const after = await request(app.getHttpServer())
      .get(`/api/cases/${caseId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(after.body.tasks.length).toBe(templateCount + 1);
    expect(after.body.tasks.at(-1).id).toBe(res.body.id);
  });

  it('edits an incomplete item\'s label and isRequired', async () => {
    const caseId = await createCase();
    const created = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/tasks`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Draft item', isRequired: true })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .patch(`/api/cases/${caseId}/tasks/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Confirmed final wording', isRequired: false })
      .expect(200);
    expect(updated.body.label).toBe('Confirmed final wording');
    expect(updated.body.isRequired).toBe(false);
  });

  it('removes an incomplete item', async () => {
    const caseId = await createCase();
    const created = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/tasks`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'To be removed' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/cases/${caseId}/tasks/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const task = await prisma.caseTask.findUnique({ where: { id: created.body.id } });
    expect(task).toBeNull();
  });

  it('never edits or removes an already-complete item', async () => {
    const caseId = await createCase();
    const created = await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/tasks`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Will be completed' })
      .expect(201);

    // Fast-forward past the field-agent completion flow (walking a full
    // assignment/check-in isn't this spec's concern — job-card.e2e-spec.ts
    // and evidence.service.ts's own tests cover that).
    await prisma.caseTask.update({ where: { id: created.body.id }, data: { isComplete: true, completedAt: new Date() } });

    await request(app.getHttpServer())
      .patch(`/api/cases/${caseId}/tasks/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Trying to rewrite it' })
      .expect(400);

    await request(app.getHttpServer())
      .delete(`/api/cases/${caseId}/tasks/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    const task = await prisma.caseTask.findUnique({ where: { id: created.body.id } });
    expect(task?.label).toBe('Will be completed');
  });

  it('rejects adding a checklist item to a COMPLETED case', async () => {
    const caseId = await createCase();
    await prisma.serviceCase.update({ where: { id: caseId }, data: { status: 'COMPLETED' } });

    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/tasks`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Too late' })
      .expect(400);
  });

  it('rejects a role outside the checklist-management set (Relationship Manager)', async () => {
    const caseId = await createCase();
    await request(app.getHttpServer())
      .post(`/api/cases/${caseId}/tasks`)
      .set('Authorization', `Bearer ${rmToken}`)
      .send({ label: 'Should not be allowed' })
      .expect(403);
  });
});
